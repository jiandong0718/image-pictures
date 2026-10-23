// 列表读取预览，详情和生成参考继续使用原图；不添加时间戳破坏缓存。
export function previewUrl(source) {
  if (!source || !/^\/(?:api\/(?:images\/file|showcase\/media\/image|assets\/file)|assets\/)/.test(source)) return source || '';
  const url = new URL(source, location.origin);
  url.searchParams.delete('t');
  url.searchParams.set('thumb', '1');
  return url.pathname + url.search;
}
