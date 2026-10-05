import { DurableObject } from "cloudflare:workers";
import { mandateDomain, mandateTypes, type MandateMessage } from "@lifeline/core";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coreEvaluator } from "./adapter.js";
import { healthReport, pausedFlag, WORKER_VERSION } from "./health.js";
import { parseRegistrations } from "./house.js";
import { registerPool } from "./register.js";
import { crudRoundTrip, migrate } from "./schema.js";

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
      migrate(this.ctx.storage.sql);
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
    if (url.pathname === "/schema/selftest") {
      if (!this.admin(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
      try {
        return Response.json(crudRoundTrip(this.ctx.storage.sql));
      } catch (error) {
        const message = error instanceof Error ? error.message : "error";
        return Response.json({ ok: false, error: message }, { status: 500 });
      }
    }
    if (url.pathname === "/admin/pool" && request.method === "POST") return this.register(request);
    const mandatePath = /^\/mandate\/(0x[0-9a-fA-F]{40})$/.exec(url.pathname);
    if (mandatePath?.[1] && request.method === "GET") return this.mandate(mandatePath[1]);
    if (url.pathname !== "/health") return new Response("lifeline", { status: 404 });
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null) await this.ctx.storage.setAlarm(Date.now() + 50);
    return Response.json(this.report());
  }

  private admin(request: Request): boolean {
    return Boolean(this.env.ADMIN_SECRET) && request.headers.get("x-admin-secret") === this.env.ADMIN_SECRET;
  }

  private async register(request: Request): Promise<Response> {
    if (!this.admin(request)) {
      await request.body?.cancel();
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    let entries;
    try {
      entries = parseRegistrations(await request.json());
    } catch (error) {
      const message = error instanceof Error ? error.message : "bad request";
      return Response.json({ error: message }, { status: 400 });
    }
    try {
      const counts = await registerPool(
        this.ctx.storage.sql,
        entries,
        (message) => this.signHouse(message),
        BigInt(Math.floor(Date.now() / 1000)),
      );
      return Response.json(counts);
    } catch (error) {
      const message = error instanceof Error ? error.message : "error";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  private async signHouse(message: MandateMessage): Promise<{ owner: Address; sig: Hex }> {
    const key = this.env.POOL_OWNER_PK;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("pool owner key missing");
    const account = privateKeyToAccount(key as Hex);
    const sig = await account.signTypedData({
      domain: mandateDomain(),
      types: mandateTypes,
      primaryType: "Mandate",
      message,
    });
    return { owner: account.address, sig };
  }

  private mandate(proxyParam: string): Response {
    let proxy: Address;
    try {
      proxy = getAddress(proxyParam);
    } catch {
      return Response.json({ error: "proxy" }, { status: 400 });
    }
    const row = this.ctx.storage.sql
      .exec(
        "SELECT owner, typed_data, sig, active, budget_used_cns, kind FROM mandates WHERE proxy = ?",
        proxy,
      )
      .toArray()[0] as
      | { owner: string; typed_data: string; sig: string; active: number; budget_used_cns: string; kind: string }
      | undefined;
    if (!row || Number(row.active) !== 1) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({
      proxy,
      owner: row.owner,
      kind: row.kind,
      active: true,
      budgetUsedCNS: row.budget_used_cns,
      typedData: JSON.parse(row.typed_data) as unknown,
      sig: row.sig,
    });
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
