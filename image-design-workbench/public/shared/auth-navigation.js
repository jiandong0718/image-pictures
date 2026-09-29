export const DEFAULT_AUTH_DESTINATION = "/playground";

export function resolveAuthDestination(rawRedirect) {
  if (typeof rawRedirect !== "string" || !rawRedirect.startsWith("/") ||
      rawRedirect.startsWith("//") || rawRedirect.includes("\\") || /[\u0000-\u001f\u007f]/.test(rawRedirect)) {
    return DEFAULT_AUTH_DESTINATION;
  }

  try {
    const target = new URL(rawRedirect, "http://localhost");
    if (target.origin !== "http://localhost" || ["/", "/login", "/register"].includes(target.pathname)) {
      return DEFAULT_AUTH_DESTINATION;
    }
    return target.pathname + target.search + target.hash;
  } catch {
    return DEFAULT_AUTH_DESTINATION;
  }
}
