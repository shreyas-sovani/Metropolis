import type { ExportedHandler } from "@cloudflare/workers-types";
import { Keeper, type KeeperEnv } from "./keeper.js";

interface Env extends KeeperEnv {
  KEEPER: DurableObjectNamespace;
}

const handler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const stub = env.KEEPER.get(env.KEEPER.idFromName("gate3"));
      return stub.fetch(request);
    }
    return new Response("lifeline");
  },
};

export { Keeper };
export default handler;
