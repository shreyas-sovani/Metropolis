import { workerOrigin } from "./http";
import { readSecret } from "./secrets";

const FORWARD = [
  "authorization",
  "content-type",
  "x-lifeline-address",
  "x-lifeline-signature",
  "x-lifeline-nonce",
  "x-turnstile-token",
];

function clientAddress(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    ""
  );
}

export async function proxyWorker(request: Request, path: string): Promise<Response> {
  const headers = new Headers();
  for (const name of FORWARD) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const ip = clientAddress(request);
  if (ip) headers.set("x-lifeline-client-ip", ip);
  const secret = readSecret("PROXY_SECRET");
  if (secret) headers.set("x-lifeline-proxy-secret", secret);
  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }
  const response = await fetch(`${workerOrigin()}${path}`, init);
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}
