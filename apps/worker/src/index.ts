import type { ExportedHandler } from "@cloudflare/workers-types";
import { Lifeline, type LifelineEnv } from "./lifeline.js";
import { addressFromWalletProof, verifyPrivyAccessToken } from "./privy.js";

interface Env extends LifelineEnv {
  LIFELINE: DurableObjectNamespace;
}

const handler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const stub = env.LIFELINE.get(env.LIFELINE.idFromName("lifeline"));
    if (url.pathname === "/health") {
      return stub.fetch(new Request(new URL("/health", request.url)));
    }
    if (url.pathname === "/session" && request.method === "GET") {
      return session(request, env);
    }
    if (url.pathname === "/claim" && request.method === "POST") {
      return stub.fetch(request);
    }
    if ((url.pathname === "/arm" || url.pathname === "/disarm") && request.method === "POST") {
      return stub.fetch(request);
    }
    if (
      url.pathname === "/schema/selftest" ||
      url.pathname === "/admin/pool" ||
      url.pathname === "/admin/breach" ||
      url.pathname === "/admin/soak" ||
      url.pathname === "/admin/soak/reset"
    ) {
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
