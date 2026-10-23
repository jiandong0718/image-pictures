"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const defaultResources = require("./creative-resources");
const audio = require("./audio-client");

const MIME_EXT = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/flac": "flac", "audio/aac": "aac" });
const MIME_BY_EXT = Object.freeze({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac", aac: "audio/aac" });

function validateUpload(upload) {
  const data = upload?.data;
  if (!Buffer.isBuffer(data) || !data.length) throw audio.inputError("上传文件不能为空");
  if (data.length > audio.MAX_AUDIO_BYTES) throw audio.inputError("上传文件不能超过 20MB", 413);
  const mime = String(upload.mime || "").split(";")[0].trim().toLowerCase();
  const ext = MIME_EXT[mime];
  const head = data.subarray(0, 16);
  const ascii = (start, end) => data.subarray(start, end).toString("ascii");
  const magicMatches = {
    png: head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    jpg: head[0] === 255 && head[1] === 216 && head[2] === 255,
    gif: ["GIF87a", "GIF89a"].includes(ascii(0, 6)),
    webp: ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP",
    mp4: ascii(4, 8) === "ftyp",
    m4a: ascii(4, 8) === "ftyp",
    webm: head.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])),
    mp3: ascii(0, 3) === "ID3" || (head[0] === 255 && (head[1] & 224) === 224),
    wav: ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE",
    ogg: ascii(0, 4) === "OggS",
    flac: ascii(0, 4) === "fLaC",
    aac: head[0] === 255 && (head[1] & 246) === 240,
  };
  if (!ext || !magicMatches[ext]) throw audio.inputError("文件类型或内容不受支持，请上传 PNG/JPG/WEBP/GIF、MP4/WebM 或常见音频");
  return { ext, mime: MIME_BY_EXT[ext], kind: mime.split("/")[0] };
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size < 1) throw audio.inputError("请求的媒体范围无效", 416);
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw audio.inputError("请求的媒体范围无效", 416);
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) throw audio.inputError("请求的媒体范围无效", 416);
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function publicAsset(asset) {
  const { ownerUserId, storagePath, generationTaskId, ...result } = asset;
  return result;
}

// 保留现有文件解析器；在其前面只做带上限的表单读取，以便同时获取 title。
async function readAssetUpload(req, readMultipartFile) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = /multipart\/form-data\s*;.*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary || boundary.length > 200) throw audio.inputError("上传表单格式不正确");
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > audio.MAX_AUDIO_BYTES) throw audio.inputError("上传请求不能超过 20MB", 413);
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks);
  let title = "";
  const divider = Buffer.from(`--${boundary}`);
  let cursor = raw.indexOf(divider);
  while (cursor >= 0) {
    const next = raw.indexOf(divider, cursor + divider.length);
    if (next < 0) break;
    const part = raw.subarray(cursor + divider.length, next);
    const split = part.indexOf(Buffer.from("\r\n\r\n"));
    if (split >= 0) {
      const headers = part.subarray(0, split).toString("utf8");
      if (/content-disposition:[^\r\n]*\bname="title"/i.test(headers) && !/\bfilename=/i.test(headers)) {
        title = part.subarray(split + 4).toString("utf8").replace(/\r\n$/, "");
      }
    }
    cursor = next;
  }
  const replay = Readable.from([raw]);
  replay.headers = req.headers;
  const upload = await readMultipartFile(replay, "file");
  return { ...upload, title: audio.cleanText(title || upload.filename || "上传素材", "标题", 160, true) };
}

function createCreativeApi(deps) {
  const { accountApi, sendJson, sendError, readJson, readMultipartFile, outputDir, resolveOutputFile, assertOwnsImageSet, tasks } = deps;
  const resources = deps.resources || defaultResources;
  const generateSpeech = deps.generateSpeech || audio.generateSpeech;
  const jobs = new Map();
  // 仅在后台工作已经停止但结算尚未确认时，允许本进程继续核对。
  const unsettled = new Map();
  const assetRoot = path.resolve(outputDir, ".creative-assets");

  function storageFile(storagePath) {
    if (typeof storagePath !== "string" || !/^\d+\/[a-f0-9-]+\.(png|jpg|webp|gif|mp4|webm|mp3|wav|ogg|m4a|flac|aac)$/.test(storagePath)) throw audio.inputError("素材文件路径不正确", 404);
    return path.join(assetRoot, storagePath);
  }

  async function saveFile(userId, data, ext) {
    const storagePath = `${defaultResources.positiveId(userId)}/${crypto.randomUUID()}.${ext}`;
    const filePath = storageFile(storagePath);
    await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await fsp.writeFile(filePath, data, { flag: "wx", mode: 0o600 });
    return { storagePath, filePath, size: data.length };
  }

  async function assetFile(user, asset) {
    let filePath;
    let expectedRoot;
    if (asset.storagePath) {
      if (asset.storagePath.split("/")[0] !== String(user.id)) throw audio.inputError("素材文件不存在", 404);
      filePath = storageFile(asset.storagePath);
      expectedRoot = assetRoot;
    } else if (asset.mediaId) {
      const media = await resources.getOwnedMedia(user.id, asset.kind, asset.mediaId);
      if (assertOwnsImageSet) await assertOwnsImageSet(user, media.image_set_id);
      filePath = asset.kind === "image" ? resolveOutputFile(media.id) : path.resolve(outputDir, media.id);
      expectedRoot = path.resolve(outputDir);
    } else throw audio.inputError("此素材没有媒体文件", 404);
    const [root, realFile] = await Promise.all([fsp.realpath(expectedRoot), fsp.realpath(filePath)]);
    const relative = path.relative(root, realFile);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw audio.inputError("素材文件不存在", 404);
    return realFile;
  }

  async function resolveAssetImages(user, ids) {
    if (!Array.isArray(ids) || ids.length > 16) throw audio.inputError("最多引用 16 张素材图片");
    const uniqueIds = [...new Set(ids.map((id) => defaultResources.positiveId(String(id).replace(/^asset:/, ""))))];
    return Promise.all(uniqueIds.map(async (id) => {
      const asset = await resources.getAsset(user.id, id);
      if (asset.kind !== "image") throw audio.inputError("参考图必须是图片素材");
      return { id: asset.imageId, assetId: asset.id, mediaId: asset.mediaId, filePath: await assetFile(user, asset), mime: asset.mime || MIME_BY_EXT[path.extname(asset.mediaId).slice(1)] };
    }));
  }

  async function streamAsset(req, res, user, id, searchParams) {
    const asset = await resources.getAsset(user.id, id);
    let filePath;
    try { filePath = await assetFile(user, asset); } catch (error) {
      if (error.code === "ENOENT") throw audio.inputError("素材文件不存在", 404);
      throw error;
    }
    let mime = asset.mime || MIME_BY_EXT[path.extname(filePath).slice(1)] || "application/octet-stream";
    const ensureThumbnail = deps.ensureThumbnail || (deps.previewCache && ((filename) => deps.previewCache.get(filename)));
    const isThumbnail = asset.kind === "image" && searchParams.get("thumb") === "1";
    if (isThumbnail && ensureThumbnail) {
      filePath = await ensureThumbnail(filePath);
      mime = "image/webp";
    }
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw audio.inputError("素材文件不存在", 404);
    const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
    const commonHeaders = { "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff", ETag: etag, "Last-Modified": stat.mtime.toUTCString() };
    // 每次请求先验证归属；即便已有浏览器缓存，也不能越过当前账户隔离。
    if (req.headers["if-none-match"]?.split(/\s*,\s*/).some((value) => value === etag || value === "*")) {
      res.writeHead(304, commonHeaders); res.end(); return;
    }
    let range;
    try { range = !req.headers["if-range"] || req.headers["if-range"] === etag ? parseRange(req.headers.range, stat.size) : null; } catch (error) {
      res.setHeader("Content-Range", `bytes */${stat.size}`); throw error;
    }
    const headers = { ...commonHeaders, "Content-Length": range ? range.end - range.start + 1 : stat.size };
    if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === "HEAD") { res.end(); return; }
    try { await pipeline(fs.createReadStream(filePath, range || {}), res); } catch (error) {
      if (!res.destroyed) res.destroy(error);
    }
  }

  async function runAudioTask(taskId, user, config, input, pricing) {
    let file;
    let asset;
    let result;
    let resultRecorded = false;
    try {
      const generated = await generateSpeech(config, input);
      validateUpload({ data: generated.data, mime: generated.mime });
      file = await saveFile(user.id, generated.data, generated.ext);
      asset = await resources.createAsset(user.id, { kind: "audio", title: Array.from(input.prompt).slice(0, 80).join(""), content: input.prompt, tags: [] }, { ...file, mime: generated.mime, taskId });
      result = { audio: publicAsset(asset), assets: [publicAsset(asset)], ...pricing };
      // 先保存已知输出；即使结算暂时失败，任务恢复仍有可定位的结果。
      await tasks.updateTaskMetadata(taskId, { result });
      resultRecorded = true;
      await tasks.completeTask(taskId, result, pricing.estimatedCost, `语音生成 ${pricing.characterCount} 字符`);
      unsettled.delete(String(taskId));
    } catch (error) {
      let assetStateUnknown = false;
      if (!asset && file) {
        // INSERT 可能已成功而随后的读取失败；确认关联之前不删除文件或退款。
        try {
          asset = await resources.findAssetByTask(user.id, taskId);
          if (!asset) await fsp.unlink(file.filePath).catch(() => {});
          else result = { audio: publicAsset(asset), assets: [publicAsset(asset)], ...pricing };
        } catch { assetStateUnknown = true; }
      }
      if (result && !resultRecorded) {
        // 瞬时写入失败只重试登记结果，不重发语音请求，也不重试扣费。
        try { await tasks.updateTaskMetadata(taskId, { result }); resultRecorded = true; } catch { /* 保留中断，不能声称成功。 */ }
      }
      const message = asset && !resultRecorded ? "音频文件已保存，但任务结果登记失败，请先核对素材库后再核对中断任务" : error.statusCode ? error.message : "音频生成或保存失败，请查看任务状态";
      const uncertain = Boolean(asset) || assetStateUnknown;
      unsettled.set(String(taskId), { userId: user.id, error: message });
      try {
        await tasks.failTask(taskId, message, { actualCost: 0, uncertain });
        if (!uncertain) unsettled.delete(String(taskId));
      } catch {
        // 保留本进程待结算标记，专用查询接口会在工作结束后暴露为可核对状态。
      }
    }
  }

  async function getOwnedAudioTask(user, taskId) {
    let task;
    try { task = await tasks.getTask(taskId, { ...user, role: "user" }); }
    catch { throw audio.inputError("暂时无法查询音频任务，请稍后重试", 503); }
    if (!task || String(task.userId) !== String(user.id) || task.kind !== "audio") throw audio.inputError("音频任务不存在", 404);
    if (["done", "error"].includes(task.status)) unsettled.delete(String(taskId));
    return task;
  }

  function hasUnsettledWork(user, taskId) {
    const pending = unsettled.get(String(taskId));
    return pending && String(pending.userId) === String(user.id);
  }

  async function audioTaskStatus(user, taskId) {
    const task = await getOwnedAudioTask(user, taskId);
    if (task.status === "running" && !jobs.has(String(taskId)) && hasUnsettledWork(user, taskId)) {
      return { ...task, status: "interrupted", error: unsettled.get(String(taskId)).error || "音频生成已停止，账单尚未完成核对" };
    }
    return task;
  }

  function recoveryPricing(task) {
    const input = task.input || {};
    const maxCost = Number(task.maxCost);
    const characterCount = Number(input.characterCount);
    const charactersPerCredit = Number(input.charactersPerCredit);
    const creditsPerUnit = Number(input.creditsPerUnit);
    if (!Number.isSafeInteger(maxCost) || maxCost < 1 || !Number.isSafeInteger(characterCount) || characterCount < 1 || characterCount > 4096 || !Number.isSafeInteger(charactersPerCredit) || charactersPerCredit < 1 || charactersPerCredit > 100000 || !Number.isSafeInteger(creditsPerUnit) || creditsPerUnit < 1 || creditsPerUnit > 100000) throw audio.inputError("任务计费记录不完整，暂时无法核对，请联系管理员", 409);
    // 通用任务存储会脱敏文本，核对必须使用提交时的字符数与价格快照。
    const pricing = { characterCount, charactersPerCredit, creditsPerUnit, estimatedCost: Math.ceil(characterCount / charactersPerCredit) * creditsPerUnit };
    if (pricing.estimatedCost !== maxCost || Number(input.estimatedCost) !== maxCost) throw audio.inputError("任务计费记录不一致，暂时无法核对，请联系管理员", 409);
    return pricing;
  }

  async function recoverAudioTask(user, taskId) {
    // 核对动作与私有素材保持一致：管理员也仅核对自己的任务。
    const task = await getOwnedAudioTask(user, taskId);
    const response = (record, recovered) => ({ ok: true, taskId, status: record.status, result: record.result, credits: record.result?.credits ?? record.credits, error: record.error || null, recovered, resubmitted: false });
    // 重复核对终态仅返回首次结算结果，绝不再结算或重新生成。
    if (["done", "error"].includes(task.status)) return response(task, false);
    if (jobs.has(String(taskId)) || (task.status !== "interrupted" && !(task.status === "running" && hasUnsettledWork(user, taskId)))) throw audio.inputError("任务仍在处理中，不能核对或重新提交", 409);
    let asset = null;
    const recordedResult = task.metadata?.result;
    try {
      // 素材关联与文件入库一起持久化，不能仅凭 metadata 缺失就认定没有产物。
      asset = await resources.findAssetByTask(user.id, taskId);
    } catch { throw audio.inputError("暂时无法核实音频素材关联，请稍后重新核对", 503); }
    try {
      // 兼容关联列加入前已经登记到 metadata 的音频。
      if (!asset && recordedResult?.audio?.id) asset = await resources.getAsset(user.id, recordedResult.audio.id);
      if (asset) {
        if (asset.kind !== "audio") asset = null;
        if (asset) {
          const filePath = await assetFile(user, asset);
          const stat = await fsp.stat(filePath);
          if (!stat.isFile() || !stat.size) asset = null;
        }
      }
    } catch (error) {
      if (error.statusCode === 404 || ["ENOENT", "ENOTDIR"].includes(error.code)) asset = null;
      else throw audio.inputError("暂时无法核实音频文件，请稍后重新核对", 503);
    }
    try {
      if (asset) {
        const pricing = recoveryPricing(task);
        const result = { ...recordedResult, audio: publicAsset(asset), assets: [publicAsset(asset)], ...pricing };
        await tasks.completeTask(taskId, result, pricing.estimatedCost, `核对语音任务 ${pricing.characterCount} 字符`);
      } else {
        await tasks.failTask(taskId, "中断任务没有可用音频输出，已释放预占积分；未重新提交语音生成", { actualCost: 0, result: { audio: null, assets: [], resubmitted: false } });
      }
    } catch (error) {
      unsettled.set(String(taskId), { userId: user.id, error: "音频账单写入失败，请稍后重新核对" });
      if (error.statusCode) throw error;
      throw audio.inputError("音频账单尚未完成核对，请稍后重试", 503);
    }
    // completeTask/failTask 本身幂等；再次读取胜出的终态，避免并发核对返回错误状态。
    const settled = await getOwnedAudioTask(user, taskId);
    if (!settled || !["done", "error"].includes(settled.status)) throw audio.inputError("结算状态尚未确认，请稍后重新核对", 503);
    unsettled.delete(String(taskId));
    return response(settled, true);
  }

  async function handle(req, res, pathname, searchParams = new URLSearchParams()) {
    const recoverMatch = /^\/api\/audio\/tasks\/([a-zA-Z0-9_-]{1,80})\/recover$/.exec(pathname);
    const audioTaskMatch = /^\/api\/audio\/tasks\/([a-zA-Z0-9_-]{1,80})$/.exec(pathname);
    const isRoute = recoverMatch || audioTaskMatch || /^\/api\/(?:prompts(?:\/\d+)?|prompt-sources(?:\/refresh)?|assets(?:\/(?:upload|file\/\d+|\d+))?|compositions\/resolve|audio(?:-config)?)$/.test(pathname);
    if (!isRoute) return false;
    const adminRoute = pathname === "/api/audio-config" && req.method === "POST";
    const user = await (adminRoute ? accountApi.requireAdmin(req, res) : accountApi.requireUser(req, res));
    if (!user) return true;
    const query = Object.fromEntries(searchParams);
    try {
      if (pathname === "/api/prompts" && req.method === "GET") {
        const { items, total, page, pageSize, ...extra } = await resources.listPrompts(user.id, query);
        sendJson(res, 200, { ok: true, items, prompts: items, pagination: { total, page, pageSize }, ...extra });
      } else if (pathname === "/api/prompts" && req.method === "POST") {
        const prompt = await resources.savePrompt(user.id, await readJson(req));
        sendJson(res, 200, { ok: true, prompt });
      } else if (/^\/api\/prompts\/\d+$/.test(pathname) && req.method === "DELETE") {
        await resources.deletePrompt(user.id, pathname.split("/").pop());
        sendJson(res, 200, { ok: true });
      } else if (pathname === "/api/prompt-sources" && req.method === "GET") {
        sendJson(res, 200, { ok: true, sources: await resources.listPromptSources() });
      } else if (pathname === "/api/prompt-sources/refresh" && req.method === "POST") {
        const payload = await readJson(req);
        if (payload.force !== undefined && typeof payload.force !== "boolean") throw audio.inputError("强制同步标记需为布尔值");
        const options = { force: payload.force === true };
        const result = payload.sourceId === "all" ? await resources.refreshAllSources(options) : await resources.refreshPromptSource(payload.sourceId, options);
        sendJson(res, 200, { ok: true, ...result });
      } else if ((pathname === "/api/assets" || pathname === "/api/audio") && req.method === "GET") {
        const { items, total, page, pageSize } = await resources.listAssets(user.id, pathname === "/api/audio" ? { ...query, kind: "audio" } : query);
        sendJson(res, 200, { ok: true, items, assets: items, ...(pathname === "/api/audio" ? { audio: items } : {}), pagination: { total, page, pageSize } });
      } else if (pathname === "/api/assets" && req.method === "POST") {
        const raw = await readJson(req);
        if (raw.url || raw.storagePath || raw.filePath) throw audio.inputError("素材只支持本地上传或自有图库引用");
        sendJson(res, 200, { ok: true, asset: publicAsset(await resources.createAsset(user.id, raw)) });
      } else if (pathname === "/api/assets/upload" && req.method === "POST") {
        const upload = await readAssetUpload(req, readMultipartFile);
        const type = validateUpload(upload);
        const saved = await saveFile(user.id, upload.data, type.ext);
        let asset;
        try { asset = await resources.createAsset(user.id, { kind: type.kind, title: upload.title, tags: [] }, { ...saved, mime: type.mime }); }
        catch (error) { await fsp.unlink(saved.filePath).catch(() => {}); throw error; }
        sendJson(res, 200, { ok: true, asset: publicAsset(asset) });
      } else if (/^\/api\/assets\/file\/\d+$/.test(pathname) && ["GET", "HEAD"].includes(req.method)) {
        await streamAsset(req, res, user, pathname.split("/").pop(), searchParams);
      } else if (/^\/api\/assets\/\d+$/.test(pathname) && req.method === "PATCH") {
        sendJson(res, 200, { ok: true, asset: publicAsset(await resources.updateAsset(user.id, pathname.split("/").pop(), await readJson(req))) });
      } else if (/^\/api\/assets\/\d+$/.test(pathname) && req.method === "DELETE") {
        const asset = await resources.deleteAsset(user.id, pathname.split("/").pop());
        // gallery mediaId 永远只删引用；随机命名上传只属于这一条素材。
        if (asset.storagePath && asset.storagePath.split("/")[0] === String(user.id)) await fsp.unlink(storageFile(asset.storagePath)).catch((error) => { if (error.code !== "ENOENT") throw error; });
        sendJson(res, 200, { ok: true });
      } else if (pathname === "/api/compositions/resolve" && req.method === "POST") {
        sendJson(res, 200, { ok: true, ...await resources.resolveComposition(user.id, await readJson(req)) });
      } else if (pathname === "/api/audio-config" && req.method === "GET") {
        sendJson(res, 200, { ok: true, config: audio.publicAudioConfig(await resources.getAudioConfig()) });
      } else if (pathname === "/api/audio-config" && req.method === "POST") {
        sendJson(res, 200, { ok: true, config: audio.publicAudioConfig(await resources.saveAudioConfig(await readJson(req))) });
      } else if (audioTaskMatch && req.method === "GET") {
        sendJson(res, 200, { ok: true, ...await audioTaskStatus(user, audioTaskMatch[1]) });
      } else if (recoverMatch && req.method === "POST") {
        const raw = await readJson(req);
        if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length) throw audio.inputError("核对任务不接受费用、输出或生成参数");
        sendJson(res, 200, await recoverAudioTask(user, recoverMatch[1]));
      } else if (pathname === "/api/audio" && req.method === "POST") {
        const input = audio.normalizeAudioInput(await readJson(req));
        const config = await resources.getAudioConfig();
        if (!audio.isConfigured(config)) throw audio.inputError("请先由管理员配置音频 API 地址、密钥和模型", 503);
        const pricing = audio.calculateAudioCost(input.prompt, config);
        const task = await tasks.createTask({ userId: user.id, kind: "audio", input: { ...input, model: config.model, ...pricing }, maxCost: pricing.estimatedCost, note: `语音生成 ${pricing.characterCount} 字符` });
        const taskId = task.id || task.taskId || task;
        const work = new Promise((resolve) => setImmediate(resolve)).then(() => runAudioTask(taskId, user, config, input, pricing));
        jobs.set(String(taskId), work);
        void work.finally(() => jobs.delete(String(taskId)));
        sendJson(res, 202, { ok: true, taskId, task, ...pricing });
      } else sendError(res, 405, "请求方法不支持");
    } catch (error) {
      if (!res.headersSent) sendError(res, error.statusCode || 400, error.statusCode ? error.message : "请求未完成，请检查输入或稍后重试");
    }
    return true;
  }

  handle.resolveAssetImages = resolveAssetImages;
  handle.waitForAudioTasks = () => Promise.all([...jobs.values()]);
  return handle;
}

module.exports = { init: defaultResources.init, createCreativeApi, validateUpload, parseRange, readAssetUpload, publicAsset };
