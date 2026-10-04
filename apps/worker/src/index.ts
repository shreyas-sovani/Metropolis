import type { ExportedHandler } from "@cloudflare/workers-types";

const handler: ExportedHandler = {
  fetch() {
    return new Response("lifeline");
  },
};

export default handler;
