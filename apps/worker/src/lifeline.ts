import { DurableObject } from "cloudflare:workers";
import { type MandateMessage } from "@lifeline/core";
import { getAddress, type Address, type Hex } from "viem";
import { coreEvaluator } from "./adapter.js";
import { clientError, countBySide, healthReport, needsAlarm, pausedFlag, WORKER_VERSION } from "./health.js";
import { blankHot, HISTORY_LIMIT, HISTORY_MS, hotDue, hydrateHot } from "./hot.js";
import { opsDue, readOps, type OpsSnapshot } from "./ops.js";
import { parseRegistrations, signMandate } from "./house.js";
import { registerPool } from "./register.js";
import { crudRoundTrip, migrate } from "./schema.js";
import { armPosition, disarmPosition, mandateFromBody } from "./arm.js";
import { clientIpFrom } from "./client-ip.js";
import { claimPosition, readClaimant, readUser } from "./claim.js";
import { meFor, storeAcceptTx } from "./me.js";
import { armBreach, noteGap, resetSoak, runKeeper, soakReport } from "./tick.js";
import { recycleClaims } from "./recycle.js";
import { sandboxArm } from "./sandbox.js";
import { readLegStates } from "./tick.js";
import { planTurnstile, tokenFrom, turnstileDenied, verifyTurnstile } from "./turnstile.js";
import { assembleTwinPairs, twinOutcome, type TwinAction, type TwinLegRow } from "./twins.js";

function clientIp(request: Request, env: { ADMIN_SECRET?: string; PROXY_SECRET?: string }): string {
  return clientIpFrom(request, env);
}

/** Stays at 2s. 43,200 alarm requests/day is inside the free Durable Object request cap. */
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
  TURNSTILE_SECRET?: string;
  PROXY_SECRET?: string;
}

export class Lifeline extends DurableObject<LifelineEnv> {
  private ticks: number[] = [];
  private knownError: string | null | undefined;
  private gap: { startedAt: number | null; maxGapMs: number } | null = null;
  private ops: OpsSnapshot | null = null;
  private opsFlight: Promise<void> | null = null;
  private hot = blankHot();
  private degraded: string | null = null;
  private lastBlock: number | null = null;

  constructor(ctx: DurableObjectState, env: LifelineEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.tryMigrate();
    });
  }

  private tryMigrate(): boolean {
    try {
      migrate(this.ctx.storage.sql);
      this.degraded = null;
      return true;
    } catch (error) {
      this.degraded = clientError(error);
      return false;
    }
  }

  private ensureHot(now: number): void {
    if (!hotDue(this.hot.loaded ? this.hot.at : null, now)) return;
    hydrateHot(this.ctx.storage.sql, this.hot, now);
    if (!this.gap) this.gap = { startedAt: this.hot.startedAt, maxGapMs: this.hot.maxGapMs };
    if (this.knownError === undefined) this.knownError = this.hot.lastError;
  }

  override async alarm(): Promise<void> {
    if (this.degraded && !this.tryMigrate()) {
      try {
        await this.ctx.storage.setAlarm(Date.now() + 20_000);
      } catch {
        // Storage is still refusing writes. /health rearms the alarm once it recovers.
      }
      return;
    }
    const started = Date.now();
    const prior = this.ticks[this.ticks.length - 1] ?? null;
    this.ticks.push(started);
    const cutoff = started - WINDOW_MS;
    while (this.ticks[0] !== undefined && this.ticks[0] < cutoff) this.ticks.shift();
    let error: string | null = null;
    try {
      if (typeof coreEvaluator() !== "function") throw new Error("core missing");
      this.ensureHot(started);
      this.gap = noteGap(this.ctx.storage.sql, started, prior, this.gap);
      const keeper = await runKeeper(this.ctx.storage.sql, this.env, started, this.hot);
      if (keeper.block != null) this.lastBlock = keeper.block;
      await recycleClaims(this.ctx.storage.sql, this.env, started, this.hot);
      this.rememberError(null);
    } catch (caught) {
      error = clientError(caught);
      this.rememberError(error);
    } finally {
      const delay = error ? 20_000 : ALARM_MS;
      try {
        await this.ctx.storage.setAlarm(Date.now() + delay);
      } catch (caught) {
        this.degraded = this.degraded ?? clientError(caught);
      }
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (this.degraded) this.tryMigrate();
    if (url.pathname === "/health" && this.degraded) {
      return Response.json({ status: "error", degraded: this.degraded }, { status: 503 });
    }
    if (url.pathname === "/schema/selftest") {
      if (!this.admin(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
      this.hot.loaded = false;
      try {
        return Response.json(crudRoundTrip(this.ctx.storage.sql));
      } catch (error) {
        const message = error instanceof Error ? error.message : "error";
        return Response.json({ ok: false, error: message }, { status: 500 });
      }
    }
    if (url.pathname === "/twins" && request.method === "GET") return this.twins();
    if (url.pathname === "/sandbox/arm" && request.method === "POST") return this.sandbox(request);
    if (url.pathname === "/admin/alarm/clear" && request.method === "POST") return this.clearAlarm(request);
    if (url.pathname === "/admin/alarm" && request.method === "GET") return this.readAlarm(request);
    if (url.pathname === "/me" && request.method === "GET") return this.me(request);
    if (url.pathname === "/claim/accepted" && request.method === "POST") return this.claimAccepted(request);
    if (url.pathname === "/sandbox/accounts" && request.method === "GET") return this.sandboxAccounts();
    if (url.pathname === "/claim" && request.method === "POST") return this.claim(request);
    if (url.pathname === "/arm" && request.method === "POST") return this.arm(request);
    if (url.pathname === "/disarm" && request.method === "POST") return this.disarm(request);
    if (url.pathname === "/admin/pool" && request.method === "POST") return this.register(request);
    if (url.pathname === "/admin/breach" && request.method === "POST") return this.breach(request);
    if (url.pathname === "/admin/soak" && request.method === "GET") return this.soak(request);
    if (url.pathname === "/admin/soak/reset" && request.method === "POST") return this.soakReset(request);
    if (url.pathname === "/actions" && request.method === "GET") return this.actions(url);
    if (url.pathname === "/saves" && request.method === "GET") return this.saves();
    const mandatePath = /^\/mandate\/(0x[0-9a-fA-F]{40})$/.exec(url.pathname);
    if (mandatePath?.[1] && request.method === "GET") return this.mandate(mandatePath[1]);
    if (url.pathname !== "/health") return new Response("lifeline", { status: 404 });
    try {
      const alarm = await this.ctx.storage.getAlarm();
      const lastTick = this.ticks[this.ticks.length - 1] ?? null;
      if (needsAlarm(alarm, lastTick, Date.now())) await this.ctx.storage.setAlarm(Date.now() + 50);
      return Response.json(await this.report());
    } catch (error) {
      this.degraded = clientError(error);
      return Response.json({ status: "error", degraded: this.degraded }, { status: 503 });
    }
  }

  private actions(url: URL): Response {
    const account = url.searchParams.get("account");
    if (!account || !/^0x[0-9a-fA-F]{40}$/.test(account)) return Response.json({ error: "address" }, { status: 400 });
    const proxy = getAddress(account);
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT tx_hash, block, amount_cns, perp_id, status, dist_before, dist_after, reason, created_at FROM actions WHERE proxy = ? ORDER BY id",
        proxy,
      )
      .toArray() as {
      tx_hash?: string | null;
      block?: number | null;
      amount_cns?: string;
      perp_id?: string;
      status?: string;
      dist_before?: string | null;
      dist_after?: string | null;
      reason?: string | null;
      created_at?: number | null;
    }[];
    return Response.json({
      account: proxy,
      actions: rows.flatMap((row) => {
        if (!row.tx_hash) return [];
        return [
          {
            txHash: row.tx_hash,
            block: row.block ?? null,
            amountCNS: row.amount_cns ?? "0",
            perpId: row.perp_id ?? "",
            status: row.status ?? "",
            distBefore: row.dist_before ?? null,
            distAfter: row.dist_after ?? null,
            reason: row.reason ?? "",
            createdAt: row.created_at == null ? null : Number(row.created_at),
          },
        ];
      }),
    });
  }

  private saves(): Response {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT tx_hash, block, amount_cns, liq_before, proxy FROM actions
         WHERE status = 'confirmed' AND liq_before IS NOT NULL AND liq_before != ''
           AND (created_at = 0 OR created_at >= ?)
         ORDER BY id DESC LIMIT ?`,
        Date.now() - HISTORY_MS,
        HISTORY_LIMIT,
      )
      .toArray() as { tx_hash?: string | null; block?: number | null; amount_cns?: string; liq_before?: string; proxy?: string }[];
    const saves = rows.flatMap((row) => {
      if (!row.tx_hash || !row.liq_before) return [];
      return [
        {
          txHash: row.tx_hash,
          block: row.block ?? null,
          amountCNS: row.amount_cns ?? "0",
          preLiq: row.liq_before,
          proxy: row.proxy ?? "",
        },
      ];
    });
    const recorded = this.ctx.storage.sql
      .exec(
        "SELECT tx_hash, proxy, side, cross_block, added_cns FROM saves ORDER BY recorded_at DESC LIMIT ?",
        HISTORY_LIMIT,
      )
      .toArray() as {
      tx_hash?: string;
      proxy?: string;
      side?: string;
      cross_block?: number | null;
      added_cns?: string;
      perp_id?: string;
    }[];
    const markets = new Map(this.hot.pools.map((row) => [row.proxy, row.market]));
    return Response.json({
      count: recorded.length,
      watched: saves.length,
      saves: recorded.flatMap((row) => {
        if (!row.tx_hash || !row.proxy) return [];
        return [
          {
            txHash: row.tx_hash,
            proxy: row.proxy,
            market: markets.get(row.proxy) ?? "",
            side: row.side ?? "",
            crossBlock: row.cross_block ?? null,
            addedCNS: row.added_cns ?? "0",
          },
        ];
      }),
    });
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
      this.ensureHot(Date.now());
      const counts = await registerPool(
        this.ctx.storage.sql,
        entries,
        (message) => this.signHouse(message),
        BigInt(Math.floor(Date.now() / 1000)),
        this.hot,
      );
      return Response.json(counts);
    } catch (error) {
      const message = error instanceof Error ? error.message : "error";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  private async arm(request: Request): Promise<Response> {
    const claimant = await readClaimant(request, this.env);
    if (claimant instanceof Response) return claimant;
    try {
      const body = (await request.json()) as { mandate?: Parameters<typeof mandateFromBody>[0]; signature?: Hex };
      if (!body.mandate || !body.signature) return Response.json({ error: "mandate" }, { status: 400 });
      const started = Date.now();
      this.ensureHot(started);
      return await armPosition(this.ctx.storage.sql, this.env, claimant, { mandate: body.mandate, signature: body.signature }, started, this.hot);
    } catch (error) {
      return Response.json({ error: clientError(error) }, { status: 400 });
    }
  }

  private async disarm(request: Request): Promise<Response> {
    const claimant = await readClaimant(request, this.env);
    if (claimant instanceof Response) return claimant;
    try {
      const body = (await request.json()) as { proxy?: string; nonce?: string; signature?: Hex };
      if (!body.proxy || !body.nonce || !body.signature) return Response.json({ error: "disarm" }, { status: 400 });
      this.ensureHot(Date.now());
      return await disarmPosition(this.ctx.storage.sql, this.env, claimant, {
        proxy: body.proxy,
        nonce: body.nonce,
        signature: body.signature,
      }, this.hot);
    } catch (error) {
      return Response.json({ error: clientError(error) }, { status: 400 });
    }
  }

  private async twins(): Promise<Response> {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT pool.proxy, pool.account_id, pool.market, pool.side, pool.role, pool.pair_id, pool.perp_id, mandates.kind, mandates.active
         FROM pool LEFT JOIN mandates ON mandates.proxy = pool.proxy
         WHERE pool.pair_id != '' LIMIT ${HISTORY_LIMIT}`,
      )
      .toArray() as {
      proxy?: string;
      account_id?: string;
      market?: string;
      side?: string;
      role?: string;
      pair_id?: string;
      perp_id?: string;
      kind?: string;
      active?: number;
    }[];
    const legs: TwinLegRow[] = [];
    const readable: { proxy: string; account_id: string; perp_id: string }[] = [];
    for (const row of rows) {
      if (!row.proxy || !row.pair_id || !row.role) continue;
      const mandate = Number(row.active) === 1 && row.kind ? row.kind : "none";
      legs.push({
        pairId: row.pair_id,
        market: row.market ?? "",
        side: row.side ?? "",
        perpId: row.perp_id ?? "",
        role: row.role,
        proxy: row.proxy,
        mandate,
      });
      if (row.account_id && row.perp_id) readable.push({ proxy: row.proxy, account_id: row.account_id, perp_id: row.perp_id });
    }
    const pairs = assembleTwinPairs(legs);
    const states = await readLegStates(this.env, readable);
    for (const pair of pairs) {
      this.fillLeg(pair.protected);
      this.fillLeg(pair.unprotected);
      for (const leg of [pair.protected, pair.unprotected]) {
        if (!leg) continue;
        const state = states.get(getAddress(leg.proxy));
        if (!state) continue;
        if (state.distanceError) {
          leg.distanceError = state.distanceError;
          continue;
        }
        if (state.distanceE6 == null) continue;
        leg.distanceE6 = state.distanceE6.toString();
        leg.outcome = twinOutcome(state.open, state.distanceE6, state.block);
      }
    }
    return Response.json({ pairs, count: pairs.length });
  }

  private fillLeg(leg: { proxy: string; actions: TwinAction[] } | null) {
    if (!leg) return;
    const actions = this.ctx.storage.sql
      .exec(
        `SELECT tx_hash, block, amount_cns FROM (
           SELECT id, tx_hash, block, amount_cns FROM actions
           WHERE proxy = ? AND status = 'confirmed' AND tx_hash LIKE '0x%'
           ORDER BY id DESC LIMIT ?
         ) AS recent ORDER BY id`,
        leg.proxy,
        HISTORY_LIMIT,
      )
      .toArray() as { tx_hash?: string; block?: number | null; amount_cns?: string }[];
    leg.actions = actions
      .filter((row) => row.tx_hash)
      .map((row) => ({ txHash: row.tx_hash as string, block: row.block ?? null, amountCNS: row.amount_cns ?? "0" }));
  }

  private async sandbox(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as { proxy?: string; triggerBps?: number; targetBps?: number; turnstileToken?: string };
      const ip = clientIp(request, this.env);
      const allowed = await this.allowTurnstile(request, body.turnstileToken ?? "", ip);
      if (allowed) return allowed;
      const started = Date.now();
      this.ensureHot(started);
      return await sandboxArm(this.ctx.storage.sql, this.env, { ...body, ip }, started, this.hot);
    } catch (error) {
      return Response.json({ error: clientError(error) }, { status: 400 });
    }
  }

  private async readAlarm(request: Request): Promise<Response> {
    if (!this.admin(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({ alarm: await this.ctx.storage.getAlarm() });
  }

  private async clearAlarm(request: Request): Promise<Response> {
    if (!this.admin(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
    await this.ctx.storage.deleteAlarm();
    return Response.json({ alarm: null });
  }

  private async claim(request: Request): Promise<Response> {
    const text = await request.clone().text();
    let bodyToken = "";
    if (text) {
      try {
        bodyToken = tokenFrom(null, JSON.parse(text) as { turnstileToken?: string });
      } catch {
        bodyToken = "";
      }
    }
    const allowed = await this.allowTurnstile(request, bodyToken, clientIp(request, this.env));
    if (allowed) return allowed;
    const claimant = await readClaimant(request, this.env);
    if (claimant instanceof Response) return claimant;
    try {
      const started = Date.now();
      this.ensureHot(started);
      return await claimPosition(this.ctx.storage.sql, this.env, claimant, started, this.hot);
    } catch (error) {
      return Response.json({ error: clientError(error) }, { status: 500 });
    }
  }

  private async allowTurnstile(request: Request, bodyToken: string, ip: string): Promise<Response | null> {
    const plan = planTurnstile(this.admin(request), tokenFrom(request.headers.get("x-turnstile-token"), { turnstileToken: bodyToken }));
    if (plan.action === "skip") return null;
    if (plan.action === "reject") return turnstileDenied();
    const ok = await verifyTurnstile(plan.token, this.env.TURNSTILE_SECRET ?? "", ip);
    return ok ? null : turnstileDenied();
  }

  private async breach(request: Request): Promise<Response> {
    if (!this.admin(request)) {
      await request.body?.cancel();
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    let proxy: Address | undefined;
    try {
      const body = (await request.json()) as { proxy?: string };
      if (!body.proxy) return Response.json({ error: "proxy" }, { status: 400 });
      proxy = getAddress(body.proxy);
    } catch {
      return Response.json({ error: "proxy" }, { status: 400 });
    }
    try {
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      this.ensureHot(Date.now());
      const terms = await armBreach(this.ctx.storage.sql, this.env, proxy, nowSec, this.hot);
      return Response.json({ proxy, ...terms });
    } catch (error) {
      const message = error instanceof Error ? error.message : "error";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  private soak(request: Request): Response {
    if (!this.admin(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json(soakReport(this.ctx.storage.sql));
  }

  private soakReset(request: Request): Response {
    if (!this.admin(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const now = Date.now();
    resetSoak(this.ctx.storage.sql, now);
    this.gap = { startedAt: now, maxGapMs: 0 };
    return Response.json(soakReport(this.ctx.storage.sql));
  }

  private async signHouse(message: MandateMessage): Promise<{ owner: Address; sig: Hex }> {
    const key = this.env.POOL_OWNER_PK;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("pool owner key missing");
    return signMandate(key, message);
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

  private rememberError(error: string | null) {
    this.hot.lastError = error;
    if (this.knownError === error) return;
    this.knownError = error;
    try {
      this.ctx.storage.sql.exec("UPDATE health_state SET last_error = ? WHERE id = 1", error);
    } catch (caught) {
      this.degraded = clientError(caught);
    }
  }

  private async refreshOps(now: number): Promise<void> {
    if (!opsDue(this.ops?.at ?? null, now)) return;
    if (this.opsFlight) return this.opsFlight;
    const available = this.hot.loaded ? this.hot.pools.filter((row) => row.status === "available") : undefined;
    this.opsFlight = readOps(this.ctx.storage.sql, this.env, now, available)
      .then((next) => {
        if (next) this.ops = next;
      })
      .catch(() => {
        // Keep the last snapshot. A miss leaves balances at zero, so low stays true.
      })
      .finally(() => {
        this.opsFlight = null;
      });
    return this.opsFlight;
  }

  private async report() {
    const now = Date.now();
    this.ensureHot(now);
    await this.refreshOps(now);
    const cutoff = now - WINDOW_MS;
    const ticks = this.ticks.filter((at) => at >= cutoff);
    const last = ticks[ticks.length - 1] ?? null;
    const available = this.hot.pools.filter((row) => row.status === "available");
    const ops = this.ops;
    const claimsToday = this.hot.claimsToday;
    const armed = this.hot.armed.length;
    return healthReport({
      lastAlarmAt: last,
      ticksLast10m: ticks.length,
      lastError: this.knownError ?? null,
      paused: pausedFlag(this.env.LIFELINE_PAUSED),
      poolAvailable: available.length,
      sponsorWei: ops?.sponsorWei ?? 0n,
      operatorWei: ops?.operatorWei ?? 0n,
      poolInBand: ops?.poolInBand ?? 0,
      poolBySide: countBySide(available.map((row) => row.side)),
      armed,
      lastBlock: this.lastBlock,
      claimsToday,
    });
  }

  private async me(request: Request): Promise<Response> {
    const user = await readUser(request, this.env);
    if (user instanceof Response) return user;
    try {
      this.ensureHot(Date.now());
      return await meFor(this.ctx.storage.sql, this.env, user.userId, Date.now());
    } catch (error) {
      return Response.json({ error: clientError(error) }, { status: 500 });
    }
  }

  private async claimAccepted(request: Request): Promise<Response> {
    const user = await readUser(request, this.env);
    if (user instanceof Response) return user;
    let txHash = "";
    try {
      const body = (await request.json()) as { txHash?: string };
      txHash = body.txHash ?? "";
    } catch {
      return Response.json({ error: "tx" }, { status: 400 });
    }
    return storeAcceptTx(this.ctx.storage.sql, user.userId, txHash);
  }

  private sandboxAccounts(): Response {
    this.ensureHot(Date.now());
    const accounts = this.hot.pools
      .filter((row) => row.role === "sandbox")
      .map((row) => ({
        proxy: row.proxy,
        market: row.market,
        side: row.side,
        leverage: row.leverage,
        perpId: row.perp_id,
      }));
    return Response.json({ accounts });
  }
}

export { WORKER_VERSION };
