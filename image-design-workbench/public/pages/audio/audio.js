import { mountLayout, setCredits } from "/shared/layout.js";
import { apiGet, apiPost, downloadFile } from "/shared/api.js";
import { escapeHtml, mediaUrl, setStatus, emptyHtml, openCreativePicker } from "/shared/creative-picker.js";
import { readStored, writeStored, audioCost, listTotal, audioFilename } from "/shared/creative-utils.js";

const $ = (id) => document.getElementById(id);
let user;
let config = {};
let pendingTask = null;
let submitting = false;
let polling = false;
let recovering = false;
let taskState = "unknown";
let historyVersion = 0;
let audioPage = 1;
let items = [];

function audioDraft() { const data = Object.fromEntries(new FormData($("audioForm"))); return { prompt: data.prompt, instructions: data.instructions, voice: data.voice, format: data.format, speed: Number(data.speed) }; }

function updateEstimate() {
  const { characterCount: count, estimatedCost: cost, charactersPerCredit: unit, creditsPerUnit } = audioCost($("prompt").value, config);
  $("characterCount").textContent = `${count} 字符`;
  $("costEstimate").textContent = `预计 ${cost} 积分 · 每 ${unit} 字符 ${creditsPerUnit} 积分`;
  $("generate").disabled = submitting || polling || recovering || Boolean(pendingTask) || !config.configured || !count;
}

function persistDraft() {
  writeStored(user.id, "audioDraft", audioDraft()); updateEstimate();
}

async function loadConfig() {
  const data = await apiGet("/api/audio-config"); config = data.config || {};
  $("configHint").textContent = config.configured ? `当前模型：${config.model}。可用音色由服务决定；生成成功后音频将保存到素材库。` : user.role === "admin" ? "音频服务尚未配置，请展开下方“音频服务配置”填写地址、密钥与模型。" : "音频服务尚未配置，请联系管理员设置后再生成。";
  if (user.role === "admin") {
    $("adminConfig").hidden = false;
    for (const key of ["apiBase", "model", "charactersPerCredit", "creditsPerUnit"]) $("configForm").elements[key].value = config[key] ?? (key === "charactersPerCredit" ? 1000 : key === "creditsPerUnit" ? 1 : "");
    if (!config.configured) $("adminConfig").open = true;
  }
  updateEstimate();
}

async function loadAudio() {
  const current = ++historyVersion; setStatus($("historyStatus"), "正在加载音频…"); $("audioList").setAttribute("aria-busy", "true");
  $("previousAudio").disabled = true; $("nextAudio").disabled = true;
  try {
    const data = await apiGet(`/api/audio?page=${audioPage}&pageSize=12`); if (current !== historyVersion) return;
    items = data.items || [];
    $("audioList").innerHTML = items.map((item, index) => `<article class="creative-audio-item"><h3>${escapeHtml(item.title || item.prompt?.slice(0, 50) || "生成音频")}</h3><p class="creative-meta">${escapeHtml(item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN") : "音频素材")}</p><audio controls preload="none" src="${escapeHtml(mediaUrl(item))}" aria-label="${escapeHtml(item.title || "音频播放")}"></audio><div class="creative-actions"><button class="btn sm" type="button" data-download="${index}">下载音频</button>${item.prompt || item.content ? `<button class="btn sm" type="button" data-reuse="${index}">复用文本</button>` : ""}</div></article>`).join("") || emptyHtml("还没有音频作品", "写下文字，生成你的第一段声音。");
    setStatus($("historyStatus"), "");
    $("previousAudio").disabled = audioPage <= 1;
    $("nextAudio").disabled = audioPage * 12 >= listTotal(data);
    $("audioPageLabel").textContent = `第 ${audioPage} 页 · 共 ${listTotal(data)} 段`;
  } catch (error) { if (current !== historyVersion) return; setStatus($("historyStatus"), error.message, "error"); if (!items.length) $("audioList").innerHTML = emptyHtml("音频暂时无法加载", "点击刷新重新加载。"); }
  finally { if (current === historyVersion) $("audioList").removeAttribute("aria-busy"); }
}

function keepPending(value) {
  pendingTask = value; taskState = "unknown"; writeStored(user.id, "audioTask", value); renderTaskActions(); updateEstimate();
}

function renderTaskActions() {
  const busy = polling || recovering;
  $("resumeTask").hidden = !pendingTask || taskState === "invalid";
  $("resumeTask").disabled = busy;
  $("recoverTask").hidden = !pendingTask || taskState !== "interrupted";
  $("recoverTask").disabled = busy;
  $("clearTask").hidden = !pendingTask || taskState !== "invalid";
  $("clearTask").disabled = busy;
}

function clearInvalidTask() {
  if (!pendingTask || taskState !== "invalid" || polling || recovering) return;
  keepPending(null);
  setStatus($("status"), "已清除失效的本地任务关联，服务端任务和账单未作修改。", "success");
}

async function recoverAudio() {
  if (!pendingTask || taskState !== "interrupted" || polling || recovering) return;
  const taskId = pendingTask; recovering = true; renderTaskActions();
  setStatus($("status"), "正在核对已保存的音频和账单，不会重新生成…");
  try {
    const data = await apiPost(`/api/audio/tasks/${encodeURIComponent(taskId)}/recover`, {});
    const task = data.task || data;
    if (!["done", "error"].includes(task.status)) throw new Error("任务尚未完成核对，请稍后重试");
    const credits = task.result?.credits ?? task.credits ?? data.credits;
    keepPending(null);
    if (typeof credits === "number") setCredits(credits);
    audioPage = 1; await loadAudio();
    setStatus($("status"), task.status === "done" ? "已找回音频并完成账单核对，可以继续创作。" : "任务已核对，未生成的音频已释放预占积分，可以继续创作。", "success");
  } catch (error) {
    if ([403, 404].includes(error.status)) taskState = "invalid";
    setStatus($("status"), `核对失败：${error.message}。原任务关联已保留。`, "error");
  } finally { recovering = false; renderTaskActions(); updateEstimate(); }
}

async function pollAudio() {
  if (!pendingTask || polling || recovering) return; polling = true; taskState = "unknown"; renderTaskActions();
  const taskId = pendingTask; const deadline = Date.now() + 5 * 60 * 1000;
  setStatus($("status"), "音频生成中，离开页面后可以回来继续查看。");
  try {
    while (Date.now() < deadline) {
      const data = await apiGet(`/api/audio/tasks/${encodeURIComponent(taskId)}`);
      if (data.status === "done") { keepPending(null); if (typeof data.result?.credits === "number") setCredits(data.result.credits); audioPage = 1; await loadAudio(); setStatus($("status"), "音频生成完成，已保存到素材库", "success"); return; }
      if (data.status === "interrupted") { taskState = "interrupted"; setStatus($("status"), `${data.error || "音频任务已中断"}。请点击“核对中断任务”，确认保存结果和账单。`, "error"); return; }
      if (data.status === "error") { keepPending(null); if (typeof data.result?.credits === "number") setCredits(data.result.credits); setStatus($("status"), data.error || "音频生成失败", "error"); return; }
      taskState = "running";
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    setStatus($("status"), "任务仍在处理中，请稍后点击“查询上次任务”，无需重新提交。");
  } catch (error) {
    taskState = [403, 404].includes(error.status) ? "invalid" : "unknown";
    setStatus($("status"), taskState === "invalid" ? `${error.message}。可以清除失效的本地关联；这不会修改服务端任务或账单。` : `任务查询中断：${error.message}。可以重新查询上次任务。`, "error");
  } finally { polling = false; renderTaskActions(); updateEstimate(); }
}

async function main() {
  const context = await mountLayout({ active: "audio", title: "音频创作", crumb: "自由创作" }); if (!context) return; user = context.me;
  const saved = readStored(user.id, "audioDraft", {});
  for (const [name, value] of Object.entries(saved)) { const field = $("audioForm").elements[name]; if (field && typeof value !== "object") field.value = String(value); }
  pendingTask = readStored(user.id, "audioTask", null); renderTaskActions();
  $("audioForm").addEventListener("input", persistDraft); $("audioForm").addEventListener("change", persistDraft);
  $("pickText").addEventListener("click", () => openCreativePicker({ kinds: ["text"], onSelect: (item) => { $("prompt").value = [$("prompt").value.trim(), item.content].filter(Boolean).join("\n\n"); persistDraft(); } }));
  $("audioForm").addEventListener("submit", async (event) => {
    event.preventDefault(); if (submitting || polling || recovering || pendingTask || !config.configured) return;
    submitting = true; updateEstimate(); setStatus($("status"), "正在提交音频任务…");
    try { const response = await apiPost("/api/audio", audioDraft()); if (!response.taskId) throw new Error("服务未返回任务编号，请先刷新音频列表确认结果"); keepPending(response.taskId); pollAudio(); }
    catch (error) { setStatus($("status"), error.message, "error"); }
    finally { submitting = false; updateEstimate(); }
  });
  $("resumeTask").addEventListener("click", pollAudio); $("refreshAudio").addEventListener("click", loadAudio);
  $("recoverTask").addEventListener("click", recoverAudio); $("clearTask").addEventListener("click", clearInvalidTask);
  $("previousAudio").addEventListener("click", () => { audioPage -= 1; loadAudio(); });
  $("nextAudio").addEventListener("click", () => { audioPage += 1; loadAudio(); });
  $("audioList").addEventListener("click", async (event) => {
    const download = event.target.closest("[data-download]"); const reuse = event.target.closest("[data-reuse]");
    if (reuse) { const item = items[Number(reuse.dataset.reuse)]; if (item) { $("prompt").value = item.prompt || item.content || ""; persistDraft(); $("prompt").focus(); } }
    if (download) { const item = items[Number(download.dataset.download)]; if (!item) return; try { await downloadFile(item.downloadUrl || mediaUrl(item), audioFilename(item)); } catch (error) { setStatus($("historyStatus"), error.message, "error"); } }
  });
  $("configForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const button = event.target.querySelector('[type="submit"]'); button.disabled = true;
    const fields = Object.fromEntries(new FormData(event.target));
    try { await apiPost("/api/audio-config", { ...fields, charactersPerCredit: Number(fields.charactersPerCredit), creditsPerUnit: Number(fields.creditsPerUnit) }); event.target.elements.apiKey.value = ""; await loadConfig(); setStatus($("configStatus"), "音频配置已保存", "success"); }
    catch (error) { setStatus($("configStatus"), error.message, "error"); } finally { button.disabled = false; }
  });
  await Promise.all([loadConfig().catch((error) => { $("configHint").textContent = `配置加载失败：${error.message}。请刷新后重试。`; }), loadAudio()]);
  updateEstimate(); if (pendingTask) pollAudio();
}
main().catch((error) => { $("page").style.visibility = "visible"; setStatus($("status"), error.message, "error"); });
