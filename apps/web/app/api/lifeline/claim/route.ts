import { proxyWorker } from "../../../../lib/worker-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return proxyWorker(request, "/claim");
}
