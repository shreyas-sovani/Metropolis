import { workerOrigin } from "./http";

const FORWARD = [
  "authorization",
  "content-type",
  "x-admin-secret",
  "x-lifeline-user",
  "x-lifeline-address",
  "x-lifeline-signature",
  "x-lifeline-nonce",
  "x-lifeline-ip",
];

export async function proxyWorker(request: Request, path: string): Promise<Response> {
  const headers = new Headers();
  for (const name of FORWARD) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
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
