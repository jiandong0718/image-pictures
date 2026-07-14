// 共享 API 客户端：统一 fetch、错误处理、401 跳登录。被各页面 JS 复用，但不含任何页面业务逻辑。

export async function apiGet(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  return handle(res);
}

export async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return handle(res);
}

export async function apiUpload(url, formData) {
  const res = await fetch(url, { method: "POST", body: formData });
  return handle(res);
}

export async function apiDelete(url) {
  const res = await fetch(url, { method: "DELETE", headers: { Accept: "application/json" } });
  return handle(res);
}

export async function downloadFile(url, fallbackFilename = "download") {
  const res = await fetch(url);
  await handleDownload(res, fallbackFilename);
}

export async function downloadJsonFile(url, body, fallbackFilename = "download") {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  await handleDownload(res, fallbackFilename);
}

// 生图接口只同步返回 taskId（避免单个请求挂太久撞上 Cloudflare 100s 超时），
// 真正的生成结果通过这里轮询 /api/tasks/:id 拿到。
export async function pollTask(taskId, { interval = 2000, timeoutMs = 5 * 60 * 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const data = await apiGet(`/api/tasks/${encodeURIComponent(taskId)}`);
    if (data.status === "done") return data.result;
    if (data.status === "error") throw new Error(data.error || "生成失败");
    if (Date.now() > deadline) throw new Error("生成超时，请稍后重试");
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // 未登录：带回跳地址去登录页。
    const redirect = encodeURIComponent(location.pathname + location.search);
    location.href = `/login?redirect=${redirect}`;
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
  if (res.status === 401) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    location.href = `/login?redirect=${redirect}`;
    throw new Error("请先登录");
  }
  if (!res.ok) {
    throw new Error(await errorTextFromResponse(res));
  }
  const blob = await res.blob();
  const filename = filenameFromDisposition(res.headers.get("Content-Disposition")) || fallbackFilename;
  triggerBrowserDownload(blob, filename);
}

export async function fetchMe() {
  const data = await apiGet("/api/auth/me");
  return data.user || null;
}

export async function logout() {
  await apiPost("/api/auth/logout", {});
  try {
    localStorage.removeItem("imageStudio:me");
  } catch {
    /* 忽略 */
  }
  location.href = "/login";
}
