// 共享 API 客户端：统一 fetch、错误处理、401 跳登录，以及非权威的会话展示快照。
// 真实鉴权始终由后端 Redis session 完成；sessionStorage 只用于跨多页跳转时立即画出壳层。

const AUTH_SNAPSHOT_KEY = "imageStudio:auth-snapshot:v1";
const AUTH_SNAPSHOT_FRESH_MS = 5 * 60 * 1000;

function normalizeAuthUser(user) {
  if (!user || typeof user !== "object" || !Number.isInteger(Number(user.id))) {
    return null;
  }
  return {
    id: Number(user.id),
    username: String(user.username || ""),
    role: user.role === "admin" ? "admin" : "user",
    credits: Number(user.credits) || 0,
    avatarUrl: String(user.avatarUrl || ""),
  };
}

export function readAuthSnapshot() {
  try {
    const value = JSON.parse(sessionStorage.getItem(AUTH_SNAPSHOT_KEY) || "");
    const user = normalizeAuthUser(value?.user);
    const savedAt = Number(value?.savedAt);
    if (!user || !Number.isFinite(savedAt)) return null;
    return { user, savedAt, fresh: Date.now() - savedAt <= AUTH_SNAPSHOT_FRESH_MS };
  } catch {
    return null;
  }
}

export function rememberAuthenticatedUser(user) {
  const normalized = normalizeAuthUser(user);
  if (!normalized) return null;
  try {
    sessionStorage.setItem(AUTH_SNAPSHOT_KEY, JSON.stringify({ user: normalized, savedAt: Date.now() }));
  } catch {
    /* 存储被禁用时，页面仍由后端 bootstrap 正常工作。 */
  }
  return normalized;
}

export function updateAuthenticatedUser(patch = {}) {
  const cached = readAuthSnapshot();
  if (!cached) return null;
  return rememberAuthenticatedUser({ ...cached.user, ...patch });
}

export function clearAuthenticatedUser() {
  try {
    sessionStorage.removeItem(AUTH_SNAPSHOT_KEY);
  } catch {
    /* 忽略不可用的浏览器存储。 */
  }
}

function loginRedirect() {
  const redirect = encodeURIComponent(location.pathname + location.search);
  location.replace(`/?auth=login&redirect=${redirect}`);
}

export async function apiRequest(url, options = {}) {
  const res = await fetch(url, options);
  return handle(res);
}

// 二进制媒体等不能走 JSON 解析的请求也复用相同的 401 会话失效处理。
export async function authorizedFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    clearAuthenticatedUser();
    loginRedirect();
    throw new Error("请先登录");
  }
  return res;
}

export async function apiGet(url) {
  return apiRequest(url, { headers: { Accept: "application/json" } });
}

export async function apiPost(url, body) {
  return apiRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

export async function apiUpload(url, formData) {
  return apiRequest(url, { method: "POST", body: formData });
}

export async function apiDelete(url) {
  return apiRequest(url, { method: "DELETE", headers: { Accept: "application/json" } });
}

export async function downloadFile(url, fallbackFilename = "download") {
  const res = await authorizedFetch(url);
  await handleDownload(res, fallbackFilename);
}

export async function downloadJsonFile(url, body, fallbackFilename = "download") {
  const res = await authorizedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  await handleDownload(res, fallbackFilename);
}

// 生图接口只同步返回 taskId（避免单个请求挂太久撞上 Cloudflare 100s 超时），
// 真正的生成结果通过这里轮询 /api/tasks/:id 拿到。
// 后端生图最多等待 360 秒，前端额外留一分钟接收结果或超时状态。
export async function pollTask(taskId, { interval = 2000, timeoutMs = 7 * 60 * 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const data = await apiGet(`/api/tasks/${encodeURIComponent(taskId)}`);
    if (data.status === "done") return data.result;
    if (data.status === "error") throw new Error(data.error || "生成失败");
    if (data.status === "interrupted") throw new Error(data.error || "任务已中断，结果待确认，请先查看图库，避免重复生成");
    if (Date.now() > deadline) throw new Error("生成超时，请稍后重试");
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // 任何受保护 API 都从这里统一回退登录，不由各页面重复判断。
    clearAuthenticatedUser();
    loginRedirect();
    throw new Error(data.error || "请先登录");
  }
  if (!res.ok) {
    const err = new Error(data.details || data.error || "请求失败");
    err.status = res.status;
    throw err;
  }
  return data;
}

function filenameFromDisposition(header) {
  if (!header) return "";
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return utf8Match[1].trim().replace(/^"|"$/g, "");
    }
  }
  const match = header.match(/filename="?([^";]+)"?/i);
  return match ? match[1].trim() : "";
}

async function errorTextFromResponse(res) {
  const data = await res.json().catch(() => null);
  if (data) {
    return data.details || data.error || data.message || "";
  }
  return res.statusText || "下载失败";
}

function triggerBrowserDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "download";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function handleDownload(res, fallbackFilename) {
  if (!res.ok) {
    throw new Error(await errorTextFromResponse(res));
  }
  const blob = await res.blob();
  const filename = filenameFromDisposition(res.headers.get("Content-Disposition")) || fallbackFilename;
  triggerBrowserDownload(blob, filename);
}

export async function bootstrapAuth({ force = false } = {}) {
  const cached = readAuthSnapshot();
  if (!force && cached?.fresh) {
    return cached.user;
  }
  if (cached) {
    const identity = await verifySession();
    if (!identity) {
      clearAuthenticatedUser();
      return null;
    }
    return updateAuthenticatedUser({ role: identity.role }) || cached.user;
  }
  const data = await apiGet("/api/bootstrap");
  if (!data.user) {
    clearAuthenticatedUser();
    return null;
  }
  return rememberAuthenticatedUser(data.user);
}

// 每个受保护页面都可用它快速验证 Redis session，而不用读取 MySQL 用户资料。
export async function verifySession() {
  const data = await apiGet("/api/auth/status");
  const user = data.user;
  if (!user || !Number.isInteger(Number(user.id))) {
    return null;
  }
  return { id: Number(user.id), role: user.role === "admin" ? "admin" : "user" };
}

// 兼容现有页面调用；账户资料页可显式 full=true，只有该路径才读取 MySQL 资料。
export async function fetchMe({ force = false, full = false } = {}) {
  if (full) {
    const data = await apiGet("/api/bootstrap");
    if (!data.user) {
      clearAuthenticatedUser();
      return null;
    }
    return rememberAuthenticatedUser(data.user);
  }
  return bootstrapAuth({ force });
}

export async function logout() {
  await apiPost("/api/auth/logout", {});
  clearAuthenticatedUser();
  location.replace("/");
}
