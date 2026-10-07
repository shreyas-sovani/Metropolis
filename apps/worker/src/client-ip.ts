/** The browser cannot choose its rate-limit IP. Only our server, holding PROXY_SECRET, can. */
export function clientIpFrom(
  request: Request,
  env: { ADMIN_SECRET?: string; PROXY_SECRET?: string },
): string {
  const admin = Boolean(env.ADMIN_SECRET) && request.headers.get("x-admin-secret") === env.ADMIN_SECRET;
  const override = request.headers.get("x-lifeline-ip")?.trim() ?? "";
  if (admin && override.length > 0) return override;
  const secret = env.PROXY_SECRET ?? "";
  const provided = request.headers.get("x-lifeline-proxy-secret") ?? "";
  const forwarded = request.headers.get("x-lifeline-client-ip")?.split(",")[0]?.trim() ?? "";
  if (secret.length > 0 && provided === secret && forwarded.length > 0) return forwarded;
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
}
