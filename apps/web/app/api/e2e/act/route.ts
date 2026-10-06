import { handleE2E } from "lifeline-e2e-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handleE2E(request);
}
