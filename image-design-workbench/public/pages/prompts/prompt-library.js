export function publicLibraryStats(sources = []) {
  return {
    total: sources.reduce((count, source) => count + Math.max(0, Number(source.count) || 0), 0),
    sourceCount: sources.length,
    cachedSources: sources.filter((source) => source.cachedAt || source.lastRefreshedAt || Number(source.count) > 0).length,
  };
}

// 逐来源确认结果；缺少回执、沿用失败缓存都不能汇报为“全部同步成功”。
export function summarizePromptRefresh(result = {}, sources = [], requestedSource = "all") {
  const raw = Array.isArray(result.results) ? result.results : Array.isArray(result.sources) ? result.sources : requestedSource !== "all" ? [result] : [];
  const expected = requestedSource === "all" ? sources : sources.filter((source) => source.id === requestedSource);
  const sourceList = expected.length ? expected : raw.map((entry) => ({ id: entry.sourceId || entry.id, title: entry.sourceName || entry.title || entry.sourceId || entry.id }));
  const rows = sourceList.map((source) => {
    const entry = raw.find((item) => String(item.sourceId || item.id || requestedSource) === String(source.id));
    const failed = !entry || entry.stale === true || entry.ok === false || entry.success === false || entry.status === "error" || entry.status === "failed" || Boolean(entry.error);
    const confirmed = entry && !failed && (entry.ok === true || entry.success === true || entry.status === "success" || Number.isFinite(entry.count));
    const status = !entry || (!failed && !confirmed) ? "unknown" : failed ? "failed" : entry.reused ? "cached" : "success";
    const count = Math.max(0, Number(entry?.count ?? source.count) || 0);
    return {
      sourceId: source.id,
      title: source.name || source.title || source.id,
      count,
      status,
      message: !entry ? "未收到该来源的同步结果" : entry.warning || entry.error || (status === "unknown" ? "同步结果尚未确认" : status === "cached" ? "沿用现有缓存" : status === "success" ? "同步成功" : "同步失败"),
    };
  });
  return { rows, successCount: rows.filter((row) => row.status === "success").length, cachedCount: rows.filter((row) => row.status === "cached").length, failedCount: rows.filter((row) => row.status === "failed").length, unknownCount: rows.filter((row) => row.status === "unknown").length };
}

export function promptPublicUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

export function promptReferenceUrls(item = {}) {
  return [...new Set([item.coverUrl, ...(Array.isArray(item.referenceImageUrls) ? item.referenceImageUrls : [])].map(promptPublicUrl).filter(Boolean))];
}
