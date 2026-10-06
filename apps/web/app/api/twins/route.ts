import { workerOrigin } from "../../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const response = await fetch(`${workerOrigin()}/twins`);
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
