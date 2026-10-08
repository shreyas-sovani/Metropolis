import type { ExportedHandler } from "@cloudflare/workers-types";
import { clientError } from "./health.js";
import { Lifeline, type LifelineEnv } from "./lifeline.js";
import { addressFromWalletProof, verifyPrivyAccessToken } from "./privy.js";

interface Env extends LifelineEnv {
  LIFELINE: DurableObjectNamespace;
}

/** Each Durable Object request counts against the same 100k/day cap as the 2s alarm. */
const HEALTH_TTL_MS = 5_000;
/** Same staleness as `needsAlarm`: past this, /health must reach the object so it can re-arm. */
const TICK_STALE_MS = 10_000;
let healthCache: { at: number; body: string } | null = null;

function ticking(body: string, now: number): boolean {
  try {
    const last = (JSON.parse(body) as { lastAlarmAt?: unknown }).lastAlarmAt;
    return typeof last === "number" && now - last <= TICK_STALE_MS;
  } catch {
    return false;
  }
}

async function health(request: Request, env: Env, stub: DurableObjectStub): Promise<Response> {
  const url = new URL(request.url);
  const admin = Boolean(env.ADMIN_SECRET) && request.headers.get("x-admin-secret") === env.ADMIN_SECRET;
  const fresh = admin && url.searchParams.has("fresh");
  const now = Date.now();
  if (!fresh && healthCache && now - healthCache.at < HEALTH_TTL_MS) {
    return new Response(healthCache.body, { status: 200, headers: { "content-type": "application/json" } });
  }
  try {
    const response = await stub.fetch(new Request(new URL("/health", request.url)));
    const body = await response.text();
    healthCache = response.status === 200 && ticking(body, now) ? { at: now, body } : null;
    return new Response(body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch (error) {
    healthCache = null;
    return Response.json({ status: "error", degraded: clientError(error) }, { status: 503 });
  }
}

const handler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const stub = env.LIFELINE.get(env.LIFELINE.idFromName("lifeline"));
    if (url.pathname === "/health") return health(request, env, stub);
    if (url.pathname === "/session" && request.method === "GET") {
      return session(request, env);
    }
    if (url.pathname === "/twins" && request.method === "GET") {
      return stub.fetch(request);
    }
    if (url.pathname === "/actions" && request.method === "GET") {
      return stub.fetch(request);
    }
    if (url.pathname === "/saves" && request.method === "GET") {
      return stub.fetch(request);
    }
    if (url.pathname === "/me" && request.method === "GET") {
      return stub.fetch(request);
    }
    if (url.pathname === "/claim/accepted" && request.method === "POST") {
      return stub.fetch(request);
    }
    if (url.pathname === "/sandbox/accounts" && request.method === "GET") {
      return stub.fetch(request);
    }
    if (url.pathname === "/claim" && request.method === "POST") {
      return stub.fetch(request);
    }
    if ((url.pathname === "/arm" || url.pathname === "/disarm" || url.pathname === "/sandbox/arm") && request.method === "POST") {
      return stub.fetch(request);
    }
    if (
      url.pathname === "/schema/selftest" ||
      url.pathname === "/admin/pool" ||
      url.pathname === "/admin/breach" ||
      url.pathname === "/admin/soak" ||
      url.pathname === "/admin/soak/reset" ||
      url.pathname === "/admin/alarm/clear" ||
      url.pathname === "/admin/alarm" ||
      url.pathname === "/admin/mandates"
    ) {
      if (url.pathname === "/admin/alarm/clear") healthCache = null;
      return stub.fetch(request);
    }
    if (request.method === "GET" && /^\/mandate\/0x[0-9a-fA-F]{40}$/.test(url.pathname)) {
      return stub.fetch(request);
    }
    return new Response("lifeline", { status: 404 });
  },
};

async function session(request: Request, env: Env): Promise<Response> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const verified = await verifyPrivyAccessToken(token, {
    verificationKey: env.PRIVY_VERIFICATION_KEY,
    appId: env.PRIVY_APP_ID,
  });
  if (!verified.ok) return Response.json({ error: "unauthorized" }, { status: 401 });
  let address = verified.identity.address;
  const proof = request.headers.get("x-lifeline-signature");
  const wallet = request.headers.get("x-lifeline-address");
  const nonce = request.headers.get("x-lifeline-nonce");
  if (proof && wallet && nonce) {
    address = await addressFromWalletProof({
      userId: verified.identity.userId,
      address: wallet,
      nonce,
      signature: proof as `0x${string}`,
    });
    if (!address) return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json({ userId: verified.identity.userId, address });
}

export { Lifeline };
export default handler;
