import type { ExportedHandler } from "@cloudflare/workers-types";
import { Lifeline, type LifelineEnv } from "./lifeline.js";

interface Env extends LifelineEnv {
  LIFELINE: DurableObjectNamespace;
}

const handler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const stub = env.LIFELINE.get(env.LIFELINE.idFromName("lifeline"));
      return stub.fetch(new Request(new URL("/health", request.url)));
    }
    return new Response("lifeline", { status: 404 });
  },
};

export { Lifeline };
export default handler;
