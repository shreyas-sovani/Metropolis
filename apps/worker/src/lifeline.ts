import { DurableObject } from "cloudflare:workers";
import { coreEvaluator } from "./adapter.js";
import { healthReport, pausedFlag, WORKER_VERSION } from "./health.js";

const ALARM_MS = 2_000;
const WINDOW_MS = 10 * 60 * 1000;

export interface LifelineEnv {
  OPERATOR_PK: string;
  POOL_OWNER_PK: string;
  SPONSOR_PK: string;
  ADMIN_SECRET: string;
  PRIVY_APP_ID: string;
  PRIVY_VERIFICATION_KEY: string;
  RPC_URLS_TESTNET: string;
  LIFELINE_PAUSED?: string;
}

export class Lifeline extends DurableObject<LifelineEnv> {
  constructor(ctx: DurableObjectState, env: LifelineEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS ticks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS health_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_error TEXT
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS pool (
          proxy TEXT PRIMARY KEY,
          status TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO health_state (id, last_error) VALUES (1, NULL)");
    });
  }

  override async alarm(): Promise<void> {
    const started = Date.now();
    let error: string | null = null;
    try {
      if (typeof coreEvaluator() !== "function") throw new Error("core missing");
      this.ctx.storage.sql.exec("INSERT INTO ticks (at) VALUES (?)", started);
      this.ctx.storage.sql.exec("DELETE FROM ticks WHERE at < ?", started - WINDOW_MS);
      this.ctx.storage.sql.exec("UPDATE health_state SET last_error = NULL WHERE id = 1");
    } catch (caught) {
      error = caught instanceof Error ? caught.message.slice(0, 180) : "error";
      this.ctx.storage.sql.exec("UPDATE health_state SET last_error = ? WHERE id = 1", error);
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/health") return new Response("lifeline", { status: 404 });
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null) await this.ctx.storage.setAlarm(Date.now() + 50);
    return Response.json(this.report());
  }

  private report() {
    const now = Date.now();
    const ticks = this.ctx.storage.sql
      .exec("SELECT at FROM ticks WHERE at >= ? ORDER BY at", now - WINDOW_MS)
      .toArray() as { at: number }[];
    const last = ticks[ticks.length - 1];
    const state = this.ctx.storage.sql
      .exec("SELECT last_error FROM health_state WHERE id = 1")
      .toArray() as { last_error: string | null }[];
    const available = this.ctx.storage.sql
      .exec("SELECT COUNT(*) AS n FROM pool WHERE status = 'available'")
      .toArray() as { n: number }[];
    return healthReport({
      lastAlarmAt: last?.at ?? null,
      ticksLast10m: ticks.length,
      lastError: state[0]?.last_error ?? null,
      paused: pausedFlag(this.env.LIFELINE_PAUSED),
      poolAvailable: Number(available[0]?.n ?? 0),
    });
  }
}

export { WORKER_VERSION };
