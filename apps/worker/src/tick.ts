import {
  ADDRESSES,
  CHAINS,
  GAS_LIMITS,
  POSITION_LONG,
  TESTNET_ID,
  buildMandate,
  desiredDepositMicro,
  evaluate,
  exchangeAbi,
  functionSelector,
  increasePositionCollateralTx,
  contractDistanceE6,
  evalQuote,
  liquidationPricePNS,
  lotToScaled,
  monDripTx,
  openChain,
  priceToMicro,
  type EvalPosition,
  type MandateMessage,
  type PositionNode,
} from "@lifeline/core";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { missingWatched, noteSaves, type MarkView } from "./saves.js";
import {
  cachedBlock,
  HISTORY_LIMIT,
  HISTORY_MS,
  insertAction,
  noteConfirmed,
  noteDistance,
  noteReverted,
  putMandate,
  setBudget,
  type HotState,
  type HouseRow,
} from "./hot.js";
import { breachMayReplace, breachTerms, houseMandate, houseTerms, serializeMandate, signMandate, type PoolRole } from "./house.js";
import type { Sql } from "./schema.js";
import type { LifelineEnv } from "./lifeline.js";

const ONE_MON = 10n ** 18n;
const OPERATOR_TARGET = 5n * ONE_MON;
const SPONSOR_FLOOR = 3n * ONE_MON;

interface ArmedRow {
  proxy: string;
  account_id: string;
  perp_id: string;
  role: string;
  typed_data: string;
  budget_used_cns: string;
  active: number;
}

function asArmed(rows: readonly HouseRow[]): ArmedRow[] {
  return [...rows];
}

interface PendingRow {
  id: number;
  proxy: string;
  perp_id: string;
  tx_hash: string | null;
  amount_cns: string;
  reason: string;
}

export function noteGap(sql: Sql, now: number, prior: number | null, cached: { startedAt: number | null; maxGapMs: number } | null): { startedAt: number | null; maxGapMs: number } {
  const stats = cached ?? loadGap(sql);
  if (prior === null || stats.startedAt === null || prior < stats.startedAt) return stats;
  const gap = now - prior;
  if (gap <= stats.maxGapMs) return stats;
  sql.exec("UPDATE keeper_stats SET max_gap_ms = ? WHERE id = 1", gap);
  return { startedAt: stats.startedAt, maxGapMs: gap };
}

function loadGap(sql: Sql): { startedAt: number | null; maxGapMs: number } {
  const stats = sql.exec("SELECT started_at, max_gap_ms FROM keeper_stats WHERE id = 1").toArray()[0] as
    | { started_at?: number | null; max_gap_ms?: number }
    | undefined;
  return { startedAt: stats?.started_at ?? null, maxGapMs: Number(stats?.max_gap_ms ?? 0) };
}

export function storedMandate(proxy: Address, typed: string): MandateMessage {
  const parsed = JSON.parse(typed) as {
    account: Address;
    perpIds: string[];
    triggerBps: number;
    targetBps: number;
    maxPerActionCNS: string;
    budgetCNS: string;
    expiry: string;
    nonce: string;
  };
  return buildMandate({
    account: getAddress(parsed.account || proxy),
    perpIds: parsed.perpIds.map((id) => BigInt(id)),
    triggerBps: parsed.triggerBps,
    targetBps: parsed.targetBps,
    maxPerActionCNS: BigInt(parsed.maxPerActionCNS),
    budgetCNS: BigInt(parsed.budgetCNS),
    expiry: BigInt(parsed.expiry),
    nonce: BigInt(parsed.nonce),
  });
}

export function urlsOf(env: LifelineEnv): string[] {
  return env.RPC_URLS_TESTNET.split(",").map((url) => url.trim()).filter((url) => url.length > 0);
}

function keyAccount(key: string, label: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${label} key missing`);
  return privateKeyToAccount(key as Hex);
}

let lastUnarmedScan = 0;

export async function runKeeper(
  sql: Sql,
  env: LifelineEnv,
  nowMs: number,
  hot?: HotState | null,
): Promise<{ block: number | null }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(env.OPERATOR_PK ?? "") || !/^0x[0-9a-fA-F]{64}$/.test(env.POOL_OWNER_PK ?? "")) {
    return { block: null };
  }
  const urls = urlsOf(env);
  const chain = openChain(TESTNET_ID, { urls, timeout: 8_000 });
  const client = chain.client;
  const confirmed = await confirmPending(sql, client, hot);
  await restoreHouse(sql, env, confirmed, BigInt(Math.floor(nowMs / 1000)), hot);
  await fundOperator(env, client);
  const paused = env.LIFELINE_PAUSED === "true" || env.LIFELINE_PAUSED === "1";
  const armed = hot?.loaded
    ? asArmed(hot.armed)
    : (sql
        .exec(
          `SELECT p.proxy, p.account_id, p.perp_id, p.role, m.typed_data, m.budget_used_cns, m.active
           FROM mandates m JOIN pool p ON p.proxy = m.proxy WHERE m.active = 1`,
        )
        .toArray() as unknown as ArmedRow[]);
  if (armed.length === 0) return { block: null };
  const exchange = ADDRESSES[TESTNET_ID].exchange;
  const accounts = await chain.readAccounts(armed.map((row) => BigInt(row.account_id)));
  const byAccount = new Map(accounts.map((account) => [account.accountId.toString(), account]));
  const positions = await readPositions(client, exchange, armed);
  const markets = await readMarkets(client, exchange, [...new Set(armed.map((row) => row.perp_id))]);
  const openDist = hot?.loaded
    ? [...hot.openDist]
    : (sql
        .exec("SELECT id, proxy, perp_id FROM actions WHERE status = 'confirmed' AND dist_after IS NULL")
        .toArray() as { id: number; proxy: string; perp_id: string }[]);
  for (const row of openDist) {
    const market = markets.get(row.perp_id);
    const position = positions.get(`${row.proxy}:${row.perp_id}`);
    if (!market || !position) continue;
    sql.exec("UPDATE actions SET dist_after = ? WHERE id = ?", distanceOf(toEvalPosition(position, market)).toString(), row.id);
    noteDistance(hot, row.id);
  }
  const block = await client.getBlockNumber();
  const nowSec = BigInt(Math.floor(nowMs / 1000));
  const operator = keyAccount(env.OPERATOR_PK, "operator");
  const wallet = createWalletClient({
    account: operator,
    chain: CHAINS[TESTNET_ID],
    transport: http(urls[0], { timeout: 8_000, retryCount: 1 }),
  });
  const pending = new Set(
    (hot?.loaded
      ? hot.pending
      : (sql.exec("SELECT proxy, perp_id FROM actions WHERE status = 'pending'").toArray() as { proxy: string; perp_id: string }[])
    ).map((row) => `${row.proxy}:${row.perp_id}`),
  );
  for (const row of armed) {
    const key = `${row.proxy}:${row.perp_id}`;
    if (pending.has(key)) continue;
    const mandate = storedMandate(getAddress(row.proxy), row.typed_data);
    const market = markets.get(row.perp_id);
    const position = positions.get(key);
    const account = byAccount.get(row.account_id);
    const evalPosition = market && position ? toEvalPosition(position, market) : null;
    const last = lastActionBlock(sql, row.proxy, row.perp_id, hot);
    const decision = evaluate(
      mandate,
      evalPosition,
      { freeBalanceMicro: account?.freeCNS ?? 0n, paused, nowSec },
      last,
      block,
      BigInt(row.budget_used_cns || "0"),
    );
    if (decision.action === "skip") {
      console.log(`skip ${row.proxy} ${row.perp_id} ${decision.reason}`);
      continue;
    }
    const capped = isCapped(decision.amountCNS, evalPosition, mandate);
    const built = increasePositionCollateralTx(getAddress(row.proxy), BigInt(row.perp_id), decision.amountCNS);
    try {
      const nonce = await takeNonce(sql, client, "operator", operator.address);
      const hash = await wallet.sendTransaction({
        account: operator,
        chain: wallet.chain,
        to: built.to,
        data: built.data,
        gas: built.gas,
        nonce,
        value: built.value,
      });
      const quote = evalPosition ? evalQuote(evalPosition) : null;
      const liqBefore = quote ? liquidationPricePNS(quote.position, quote.market).toString() : "";
      insertAction(sql, hot, {
        proxy: row.proxy,
        perp_id: row.perp_id,
        amount_cns: decision.amountCNS.toString(),
        tx_hash: hash,
        dist_before: decision.distBefore.toString(),
        status: "pending",
        reason: capped ? "capped" : "",
        liq_before: liqBefore,
        created_at: nowMs,
      });
      pending.add(key);
      console.log(`top-up ${row.proxy} ${row.perp_id} ${decision.amountCNS} ${hash}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "send failed";
      if (/nonce/i.test(message)) {
        sql.exec("UPDATE keeper_stats SET nonce_errors = nonce_errors + 1 WHERE id = 1");
        sql.exec("DELETE FROM keys WHERE name = 'operator'");
      }
      throw new Error(message.slice(0, 180));
    }
  }
  const views = new Map<string, MarkView>();
  for (const row of armed) {
    const market = markets.get(row.perp_id);
    const position = positions.get(`${row.proxy}:${row.perp_id}`);
    if (!market || !position) continue;
    views.set(`${row.proxy}:${row.perp_id}`, {
      mark: position.markPNS,
      open: position.position.lotLNS > 0n,
      block: Number(block),
    });
  }
  try {
    noteSaves(sql, views, nowMs);
    const missing = missingWatched(views);
    if (missing.length > 0 && nowMs - lastUnarmedScan >= 60_000) {
      lastUnarmedScan = nowMs;
      const extraArmed = missing.map((row) => ({
        proxy: row.proxy,
        account_id: row.accountId,
        perp_id: row.perpId,
        role: "pool",
        typed_data: "",
        budget_used_cns: "0",
        active: 1,
      }));
      const extra = await readPositions(client, exchange, extraArmed);
      for (const row of missing) {
        const position = extra.get(`${row.proxy}:${row.perpId}`);
        if (!position) continue;
        views.set(`${row.proxy}:${row.perpId}`, {
          mark: position.markPNS,
          open: position.position.lotLNS > 0n,
          block: Number(block),
        });
      }
      noteSaves(sql, views, nowMs);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "saves";
    console.log(`saves ${message.slice(0, 120)}`);
  }
  await runCanary(sql, env, nowMs, hot);
  return { block: Number(block) };
}

const CANARY_MS = 10 * 60 * 1000;

/** A canary that reverts, or that targets any selector other than collateral top-up, is degraded. */
export function judgeCanary(selector: string, reverted: boolean): { degraded: boolean; reason: string | null } {
  const allowed = functionSelector("increasePositionCollateral").toLowerCase();
  if (selector.toLowerCase() !== allowed || reverted) return { degraded: true, reason: "canary revert" };
  return { degraded: false, reason: null };
}

export function canaryDue(lastAt: number | null, now: number): boolean {
  return lastAt === null || now - lastAt >= CANARY_MS;
}

async function runCanary(sql: Sql, env: LifelineEnv, nowMs: number, hot?: HotState | null): Promise<void> {
  let last: number | null;
  if (hot?.loaded) {
    last = hot.canaryAt;
  } else {
    const row = sql.exec("SELECT canary_at FROM keeper_stats WHERE id = 1").toArray()[0] as
      | { canary_at?: number | null }
      | undefined;
    last = row?.canary_at === undefined || row.canary_at === null ? null : Number(row.canary_at);
  }
  if (!canaryDue(last, nowMs)) return;
  sql.exec("UPDATE keeper_stats SET canary_at = ? WHERE id = 1", nowMs);
  if (hot) hot.canaryAt = nowMs;
  const pool = hot?.loaded
    ? hot.canaryProxy ?? undefined
    : (sql.exec("SELECT proxy, perp_id FROM pool WHERE role = 'pool' LIMIT 1").toArray()[0] as
        | { proxy?: string; perp_id?: string }
        | undefined);
  if (!pool?.proxy || !pool.perp_id) return;
  const operator = keyAccount(env.OPERATOR_PK, "operator");
  const built = increasePositionCollateralTx(getAddress(pool.proxy), BigInt(pool.perp_id), 1n);
  const chain = openChain(TESTNET_ID, { urls: urlsOf(env), timeout: 8_000 });
  const verdict = judgeCanary(functionSelector("increasePositionCollateral"), false);
  if (verdict.degraded) {
    sql.exec("UPDATE health_state SET last_error = ? WHERE id = 1", verdict.reason);
    return;
  }
  try {
    await chain.client.call({ account: operator.address, to: built.to, data: built.data });
  } catch {
    sql.exec("UPDATE health_state SET last_error = ? WHERE id = 1", "canary revert");
    throw new Error("canary revert");
  }
}

function isCapped(amount: bigint, position: EvalPosition | null, mandate: MandateMessage): boolean {
  if (!position) return false;
  const desired = desiredDepositMicro({
    side: position.side,
    entryMicro: position.entryMicro,
    lot: position.lot,
    fundingMicro: position.fundingMicro,
    mmf: position.mmf,
    markMicro: position.markMicro,
    targetBps: BigInt(mandate.targetBps),
  });
  const raw = desired > position.depositMicro ? desired - position.depositMicro : 0n;
  return amount < raw;
}

function lastActionBlock(sql: Sql, proxy: string, perpId: string, hot?: HotState | null): bigint | null {
  if (hot?.loaded) return cachedBlock(hot, proxy, perpId);
  const row = sql
    .exec(
      "SELECT block FROM actions WHERE proxy = ? AND perp_id = ? AND status = 'confirmed' AND block IS NOT NULL ORDER BY id DESC LIMIT 1",
      proxy,
      perpId,
    )
    .toArray()[0] as { block?: number | null } | undefined;
  return row?.block === undefined || row.block === null ? null : BigInt(row.block);
}

async function confirmPending(
  sql: Sql,
  client: PublicClient,
  hot?: HotState | null,
): Promise<{ proxy: string; perp_id: string }[]> {
  const confirmed: { proxy: string; perp_id: string }[] = [];
  const rows = hot?.loaded
    ? [...hot.pending]
    : (sql
        .exec("SELECT id, proxy, perp_id, tx_hash, amount_cns, reason FROM actions WHERE status = 'pending'")
        .toArray() as unknown as PendingRow[]);
  for (const row of rows) {
    if (!row.tx_hash || !row.tx_hash.startsWith("0x")) continue;
    try {
      const receipt = await client.getTransactionReceipt({ hash: row.tx_hash as Hex });
      if (receipt.status !== "success") {
        sql.exec("UPDATE actions SET status = 'reverted', block = ? WHERE id = ?", Number(receipt.blockNumber), row.id);
        sql.exec("UPDATE keeper_stats SET nonce_errors = nonce_errors + 1 WHERE id = 1");
        noteReverted(hot, row.id);
        continue;
      }
      const block = Number(receipt.blockNumber);
      sql.exec("UPDATE actions SET status = 'confirmed', block = ? WHERE id = ?", block, row.id);
      noteConfirmed(hot, row.id, block);
      confirmed.push({ proxy: row.proxy, perp_id: row.perp_id });
      const mandate = hot?.loaded
        ? hot.mandates.find((item) => item.proxy === row.proxy)
        : (sql.exec("SELECT budget_used_cns FROM mandates WHERE proxy = ?", row.proxy).toArray()[0] as
            | { budget_used_cns?: string }
            | undefined);
      const used = BigInt(mandate?.budget_used_cns || "0") + BigInt(row.amount_cns);
      sql.exec("UPDATE mandates SET budget_used_cns = ? WHERE proxy = ?", used.toString(), row.proxy);
      setBudget(hot, row.proxy, used.toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/not found|could not be found/i.test(message)) continue;
      throw error;
    }
  }
  return confirmed;
}

async function fundOperator(env: LifelineEnv, client: PublicClient) {
  const operator = keyAccount(env.OPERATOR_PK, "operator");
  const balance = await client.getBalance({ address: operator.address });
  if (balance >= ONE_MON) return;
  const sponsor = keyAccount(env.SPONSOR_PK, "sponsor");
  const sponsorBalance = await client.getBalance({ address: sponsor.address });
  const gas = GAS_LIMITS.monDrip ?? 36_000n;
  const fee = gas * 100_000_000_000n;
  const room = sponsorBalance > SPONSOR_FLOOR + fee ? sponsorBalance - SPONSOR_FLOOR - fee : 0n;
  const need = OPERATOR_TARGET > balance ? OPERATOR_TARGET - balance : 0n;
  const value = need < room ? need : room;
  if (value <= 0n) {
    console.log("skip operator top-up sponsor floor");
    return;
  }
  const built = monDripTx(operator.address, value);
  const wallet = createWalletClient({
    account: sponsor,
    chain: CHAINS[TESTNET_ID],
    transport: http(urlsOf(env)[0], { timeout: 8_000, retryCount: 1 }),
  });
  const nonce = await client.getTransactionCount({ address: sponsor.address, blockTag: "pending" });
  const hash = await wallet.sendTransaction({
    account: sponsor,
    chain: wallet.chain,
    to: built.to,
    data: built.data,
    gas: built.gas,
    value: built.value,
    nonce,
  });
  console.log(`operator top-up ${hash}`);
}

interface MarketScale {
  priceDecimals: number;
  lotDecimals: number;
  mmf: bigint;
  maintHdths: bigint;
}

function marginHdths(raw: unknown): bigint {
  if (Array.isArray(raw)) {
    const value = raw[1] as bigint | undefined;
    if (typeof value !== "bigint") throw new Error("margin fractions missing");
    return value;
  }
  if (raw && typeof raw === "object" && "perpMaintMarginFracHdths" in raw) {
    const value = (raw as { perpMaintMarginFracHdths: bigint }).perpMaintMarginFracHdths;
    if (typeof value !== "bigint") throw new Error("margin fractions missing");
    return value;
  }
  throw new Error("margin fractions missing");
}

async function readMarkets(client: PublicClient, exchange: Address, perpIds: string[]): Promise<Map<string, MarketScale>> {
  const markets = new Map<string, MarketScale>();
  if (perpIds.length === 0) return markets;
  const packed = await client.multicall({
    contracts: perpIds.flatMap((id) => [
      {
        address: exchange,
        abi: exchangeAbi,
        functionName: "getPerpetualInfoV2" as const,
        args: [BigInt(id)] as const,
      },
      {
        address: exchange,
        abi: exchangeAbi,
        functionName: "getMarginFractions" as const,
        args: [BigInt(id), 0n] as const,
      },
    ]),
    allowFailure: false,
  });
  perpIds.forEach((id, index) => {
    const info = packed[index * 2] as { priceDecimals: bigint; lotDecimals: bigint };
    const hdths = marginHdths(packed[index * 2 + 1]);
    if (hdths <= 0n) throw new Error(`perp ${id} maintenance fraction is 0`);
    markets.set(id, {
      priceDecimals: Number(info.priceDecimals),
      lotDecimals: Number(info.lotDecimals),
      mmf: hdths / 100n,
      maintHdths: hdths,
    });
  });
  return markets;
}

async function readPositions(
  client: PublicClient,
  exchange: Address,
  armed: readonly ArmedRow[],
): Promise<Map<string, { position: PositionNode; markPNS: bigint; markValid: boolean }>> {
  const out = new Map<string, { position: PositionNode; markPNS: bigint; markValid: boolean }>();
  const rows = await client.multicall({
    contracts: armed.map((row) => ({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getPositionV2" as const,
      args: [BigInt(row.perp_id), BigInt(row.account_id)] as const,
    })),
    allowFailure: false,
  });
  armed.forEach((row, index) => {
    const packed = rows[index] as readonly [PositionNode, bigint, boolean];
    out.set(`${row.proxy}:${row.perp_id}`, { position: packed[0], markPNS: packed[1], markValid: packed[2] });
  });
  return out;
}

function toEvalPosition(
  read: { position: PositionNode; markPNS: bigint; markValid: boolean },
  market: MarketScale,
): EvalPosition {
  const side = read.position.positionType === POSITION_LONG ? 1n : -1n;
  return {
    markPriceValid: read.markValid,
    open: read.position.lotLNS > 0n,
    side,
    positionType: read.position.positionType,
    entryMicro: priceToMicro(read.position.pricePNS, market.priceDecimals),
    lot: lotToScaled(read.position.lotLNS, market.lotDecimals),
    depositMicro: read.position.depositCNS,
    fundingMicro: read.position.premiumPnlCNS,
    mmf: market.mmf,
    markMicro: priceToMicro(read.markPNS, market.priceDecimals),
    pricePNS: read.position.pricePNS,
    lotLNS: read.position.lotLNS,
    priceDecimals: market.priceDecimals,
    lotDecimals: market.lotDecimals,
    maintHdths: market.maintHdths,
    markPNS: read.markPNS,
  };
}

export interface LegRead {
  distanceE6: bigint | null;
  open: boolean;
  block: number | null;
  distanceError?: "rpc";
}

export async function readLegStates(
  env: LifelineEnv,
  rows: readonly { proxy: string; account_id: string; perp_id: string }[],
): Promise<Map<string, LegRead>> {
  const out = new Map<string, LegRead>();
  if (rows.length === 0) return out;
  const failed = (): Map<string, LegRead> => {
    for (const row of rows) {
      out.set(getAddress(row.proxy), { distanceE6: null, open: true, block: null, distanceError: "rpc" });
    }
    return out;
  };
  try {
    const endpoint = urlsOf(env)[0];
    if (!endpoint) return failed();
    const base = CHAINS[TESTNET_ID];
    const client = createPublicClient({
      chain: {
        ...base,
        contracts: {
          ...base.contracts,
          multicall3: { address: ADDRESSES[TESTNET_ID].multicall3 },
        },
      },
      transport: http(endpoint, { timeout: 8_000, retryCount: 0 }),
    });
    const armed = rows.map((row) => ({
      proxy: row.proxy,
      account_id: row.account_id,
      perp_id: row.perp_id,
      role: "twin-protected",
      typed_data: "",
      budget_used_cns: "0",
      active: 1,
    }));
    const exchange = ADDRESSES[TESTNET_ID].exchange;
    const positions = await readPositions(client, exchange, armed);
    const markets = await readMarkets(client, exchange, [...new Set(rows.map((row) => row.perp_id))]);
    for (const row of rows) {
      const market = markets.get(row.perp_id);
      const position = positions.get(`${row.proxy}:${row.perp_id}`);
      if (!market || !position) {
        out.set(getAddress(row.proxy), { distanceE6: null, open: true, block: null, distanceError: "rpc" });
        continue;
      }
      const view = toEvalPosition(position, market);
      out.set(getAddress(row.proxy), { distanceE6: distanceOf(view), open: view.open, block: null });
    }
    return out;
  } catch {
    return failed();
  }
}

export async function readDistances(
  env: LifelineEnv,
  rows: readonly { proxy: string; account_id: string; perp_id: string }[],
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  if (rows.length === 0) return out;
  const endpoint = urlsOf(env)[0];
  if (!endpoint) return out;
  // One aggregate3 HTTP call. The batched public client would emit one subrequest per position.
  const base = CHAINS[TESTNET_ID];
  const client = createPublicClient({
    chain: {
      ...base,
      contracts: {
        ...base.contracts,
        multicall3: { address: ADDRESSES[TESTNET_ID].multicall3 },
      },
    },
    transport: http(endpoint, { timeout: 8_000, retryCount: 0 }),
  });
  const armed = rows.map((row) => ({
    proxy: row.proxy,
    account_id: row.account_id,
    perp_id: row.perp_id,
    role: "pool",
    typed_data: "",
    budget_used_cns: "0",
    active: 1,
  }));
  const exchange = ADDRESSES[TESTNET_ID].exchange;
  const positions = await readPositions(client, exchange, armed);
  const markets = await readMarkets(client, exchange, [...new Set(rows.map((row) => row.perp_id))]);
  for (const row of rows) {
    const market = markets.get(row.perp_id);
    const position = positions.get(`${row.proxy}:${row.perp_id}`);
    if (!market || !position) continue;
    out.set(getAddress(row.proxy), distanceOf(toEvalPosition(position, market)));
  }
  return out;
}

export async function readAccountState(
  env: LifelineEnv,
  row: { proxy: string; account_id: string; perp_id: string },
): Promise<{ position: EvalPosition; freeCNS: bigint; block: bigint } | null> {
  const chain = openChain(TESTNET_ID, { urls: urlsOf(env), timeout: 8_000 });
  const accounts = await chain.readAccounts([BigInt(row.account_id)]);
  const exchange = ADDRESSES[TESTNET_ID].exchange;
  const positions = await readPositions(chain.client, exchange, [
    { ...row, role: "pool", typed_data: "", budget_used_cns: "0", active: 1 },
  ]);
  const markets = await readMarkets(chain.client, exchange, [row.perp_id]);
  const market = markets.get(row.perp_id);
  const position = positions.get(`${row.proxy}:${row.perp_id}`);
  if (!market || !position) return null;
  const block = await chain.client.getBlockNumber();
  return {
    position: toEvalPosition(position, market),
    freeCNS: accounts[0]?.freeCNS ?? 0n,
    block,
  };
}

const BROADCAST_FEE = 200_000_000_000n;
const BROADCAST_PRIORITY = 2_000_000_000n;

/** Sign once and submit the same raw transaction to each RPC. */
export async function broadcastTx(
  urls: readonly string[],
  account: ReturnType<typeof privateKeyToAccount>,
  tx: { to: Address; data: Hex; gas: bigint; value?: bigint; nonce: number },
): Promise<Hex> {
  const endpoint = urls.find((url) => url.length > 0);
  if (!endpoint) throw new Error("no rpc");
  const wallet = createWalletClient({
    account,
    chain: CHAINS[TESTNET_ID],
    transport: http(endpoint, { timeout: 8_000, retryCount: 0 }),
  });
  const serialized = await wallet.signTransaction({
    account,
    chain: CHAINS[TESTNET_ID],
    to: tx.to,
    data: tx.data,
    gas: tx.gas,
    nonce: tx.nonce,
    value: tx.value ?? 0n,
    maxFeePerGas: BROADCAST_FEE,
    maxPriorityFeePerGas: BROADCAST_PRIORITY,
    type: "eip1559",
  });
  const hash = keccak256(serialized);
  let last = "broadcast failed";
  for (const url of urls) {
    if (!url) continue;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [serialized] }),
      });
      const body = (await response.json()) as { error?: { message?: string }; result?: string };
      if (!body.error && typeof body.result === "string" && body.result.startsWith("0x")) return body.result as Hex;
      const message = body.error?.message ?? "rpc";
      if (/already known|nonce too low|already imported/i.test(message)) return hash;
      last = message;
    } catch (error) {
      last = error instanceof Error ? error.message : "rpc";
    }
  }
  throw new Error(last.slice(0, 160));
}

/** A few receipt polls stay inside the Worker subrequest cap. */
export async function waitForReceipt(client: PublicClient, hash: Hex): Promise<TransactionReceipt> {
  let last = "receipt pending";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.getTransactionReceipt({ hash });
    } catch (error) {
      last = error instanceof Error ? error.message : "receipt pending";
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(last.replace(/https?:\/\/\S+/g, "rpc").slice(0, 120));
}

/** Use the higher of the stored nonce and the chain's pending count. External sends move the chain ahead. */
export function nextNonce(stored: number | null, chain: number): number {
  if (stored === null || stored < chain || stored > chain + 1) return chain;
  return stored;
}

export async function takeNonce(sql: Sql, client: PublicClient, name: string, address: Address): Promise<number> {
  const count = await client.getTransactionCount({ address, blockTag: "pending" });
  const row = sql.exec("SELECT next_nonce FROM keys WHERE name = ?", name).toArray()[0] as
    | { next_nonce?: number }
    | undefined;
  const nonce = nextNonce(row?.next_nonce === undefined ? null : Number(row.next_nonce), count);
  sql.exec(
    "INSERT INTO keys (name, next_nonce) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET next_nonce = excluded.next_nonce",
    name,
    nonce + 1,
  );
  return nonce;
}

export function distanceOf(position: EvalPosition): bigint {
  return contractDistanceE6(
    {
      positionType: position.positionType,
      pricePNS: position.pricePNS,
      lotLNS: position.lotLNS,
      depositCNS: position.depositMicro,
      premiumPnlCNS: position.fundingMicro,
    },
    {
      priceDecimals: position.priceDecimals,
      lotDecimals: position.lotDecimals,
      maintHdths: position.maintHdths,
    },
    position.markPNS,
  );
}

export async function armBreach(
  sql: Sql,
  env: LifelineEnv,
  proxy: Address,
  nowSec: bigint,
  hot?: HotState | null,
): Promise<{ triggerBps: number; targetBps: number; armed: boolean }> {
  const row = hot?.loaded
    ? hot.pools.find((item) => item.proxy === proxy)
    : (sql.exec("SELECT account_id, perp_id, role FROM pool WHERE proxy = ?", proxy).toArray()[0] as
        | { account_id?: string; perp_id?: string; role?: string }
        | undefined);
  if (!row?.account_id || !row.perp_id || !row.role) throw new Error("proxy not registered");
  const existing = hot?.loaded
    ? hot.mandates.find((item) => item.proxy === proxy)
    : (sql.exec("SELECT active FROM mandates WHERE proxy = ?", proxy).toArray()[0] as { active?: number } | undefined);
  const active = existing?.active === undefined ? null : Number(existing.active);
  if (!breachMayReplace(active)) return { triggerBps: 0, targetBps: 0, armed: false };
  const chain = openChain(TESTNET_ID, { urls: urlsOf(env), timeout: 8_000 });
  const exchange = ADDRESSES[TESTNET_ID].exchange;
  const markets = await readMarkets(chain.client, exchange, [row.perp_id]);
  const positions = await readPositions(chain.client, exchange, [
    { proxy, account_id: row.account_id, perp_id: row.perp_id, role: row.role, typed_data: "", budget_used_cns: "0", active: 1 },
  ]);
  const market = markets.get(row.perp_id);
  const position = positions.get(`${proxy}:${row.perp_id}`);
  if (!market || !position) throw new Error("position missing");
  const evalPosition = toEvalPosition(position, market);
  const terms = breachTerms(distanceOf(evalPosition));
  const message = buildMandate({
    account: proxy,
    perpIds: [BigInt(row.perp_id)],
    triggerBps: terms.triggerBps,
    targetBps: terms.targetBps,
    maxPerActionCNS: 150_000_000n,
    budgetCNS: 300_000_000n,
    expiry: nowSec + 29n * 24n * 60n * 60n,
    nonce: 0n,
  });
  const signed = await signMandate(env.POOL_OWNER_PK, message);
  sql.exec(
    `INSERT INTO mandates (proxy, owner, typed_data, sig, active, budget_used_cns, kind)
     VALUES (?, ?, ?, ?, 1, '0', 'breach')
     ON CONFLICT(proxy) DO UPDATE SET
       owner = excluded.owner,
       typed_data = excluded.typed_data,
       sig = excluded.sig,
       active = 1,
       kind = 'breach'`,
    proxy,
    signed.owner,
    serializeMandate(message),
    signed.sig,
  );
  const previous = hot?.mandates.find((item) => item.proxy === proxy);
  putMandate(hot, {
    proxy,
    owner: signed.owner,
    typed_data: serializeMandate(message),
    sig: signed.sig,
    active: 1,
    budget_used_cns: previous?.budget_used_cns ?? "0",
    kind: "breach",
  });
  return { ...terms, armed: true };
}

export async function restoreHouse(
  sql: Sql,
  env: LifelineEnv,
  confirmed: readonly { proxy: string; perp_id: string }[],
  nowSec: bigint,
  hot?: HotState | null,
) {
  const rows = hot?.loaded
    ? hot.armed.filter((row) => row.active === 1 && row.kind === "breach")
    : (sql
        .exec(
          `SELECT p.proxy, p.perp_id, p.role, m.kind FROM mandates m
           JOIN pool p ON p.proxy = m.proxy WHERE m.active = 1 AND m.kind = 'breach'`,
        )
        .toArray() as { proxy: string; perp_id: string; role: string; kind: string }[]);
  for (const row of rows) {
    if (!confirmed.some((item) => item.proxy === row.proxy && item.perp_id === row.perp_id)) continue;
    const role = row.role as PoolRole;
    if (!houseTerms(role)) continue;
    const message = houseMandate({
      account: getAddress(row.proxy),
      perpId: BigInt(row.perp_id),
      role,
      nowSec,
    });
    if (!message) continue;
    const signed = await signMandate(env.POOL_OWNER_PK, message);
    sql.exec(
      `UPDATE mandates SET owner = ?, typed_data = ?, sig = ?, active = 1, kind = 'house' WHERE proxy = ?`,
      signed.owner,
      serializeMandate(message),
      signed.sig,
      row.proxy,
    );
    const previous = hot?.mandates.find((item) => item.proxy === row.proxy);
    if (previous) {
      putMandate(hot, {
        ...previous,
        owner: signed.owner,
        typed_data: serializeMandate(message),
        sig: signed.sig,
        active: 1,
        kind: "house",
      });
    }
  }
}

export function soakReport(sql: Sql, now = Date.now()) {
  const since = now - HISTORY_MS;
  const stats = sql.exec("SELECT max_gap_ms, nonce_errors, started_at FROM keeper_stats WHERE id = 1").toArray()[0] as
    | { max_gap_ms?: number; nonce_errors?: number; started_at?: number | null }
    | undefined;
  const pending = sql.exec("SELECT COUNT(*) AS n FROM actions WHERE status = 'pending'").toArray()[0] as { n?: number } | undefined;
  const armed = sql.exec("SELECT COUNT(*) AS n FROM mandates WHERE active = 1").toArray()[0] as { n?: number } | undefined;
  const kinds = sql
    .exec(
      `SELECT status, reason, COUNT(*) AS n FROM (
         SELECT status, reason FROM actions
         WHERE created_at = 0 OR created_at >= ?
         ORDER BY id DESC
         LIMIT ?
       ) AS bounded
       GROUP BY status, reason`,
      since,
      HISTORY_LIMIT,
    )
    .toArray() as { status: string; reason: string; n: number }[];
  const health = sql.exec("SELECT last_error FROM health_state WHERE id = 1").toArray()[0] as
    | { last_error?: string | null }
    | undefined;
  const recent = sql
    .exec(
      `SELECT proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason
       FROM actions
       WHERE created_at = 0 OR created_at >= ?
       ORDER BY id DESC
       LIMIT ?`,
      since,
      HISTORY_LIMIT,
    )
    .toArray();
  return {
    maxGapMs: Number(stats?.max_gap_ms ?? 0),
    nonceErrors: Number(stats?.nonce_errors ?? 0),
    startedAt: stats?.started_at ?? null,
    pending: Number(pending?.n ?? 0),
    armed: Number(armed?.n ?? 0),
    lastError: health?.last_error ?? null,
    actions: kinds,
    recent,
  };
}

export function resetSoak(sql: Sql, now: number) {
  sql.exec("UPDATE keeper_stats SET max_gap_ms = 0, nonce_errors = 0, started_at = ? WHERE id = 1", now);
}
