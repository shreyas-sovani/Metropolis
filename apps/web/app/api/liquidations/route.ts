import { historyStore } from "../../../lib/history-store";
import { handleLiquidations } from "../../../lib/liquidations";

export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handleLiquidations(historyStore, Date.now());
}
