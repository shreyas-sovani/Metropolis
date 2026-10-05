import {
  ADDRESSES,
  CHAINS,
  GAS_LIMITS,
  POSITION_LONG,
  TESTNET_ID,
  buildMandate,
  desiredDepositMicro,
  distanceE6,
  evaluate,
  exchangeAbi,
  increasePositionCollateralTx,
  liquidationPriceMicro,
  lotToScaled,
  monDripTx,
  openChain,
  priceToMicro,
  type EvalPosition,
  type MandateMessage,
  type PositionNode,
} from "@lifeline/core";
import {
  createWalletClient,
  getAddress,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { breachTerms, houseMandate, houseTerms, serializeMandate, signMandate, type PoolRole } from "./house.js";
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

interface PendingRow {
  id: number;
  proxy: string;
  perp_id: string;
  tx_hash: string | null;
  amount_cns: string;
  reason: string;
}

export function noteGap(sql: Sql, now: number) {
  const previous = sql.exec("SELECT MAX(at) AS at FROM ticks").toArray()[0] as { at?: number | null } | undefined;
  const stats = sql.exec("SELECT started_at, max_gap_ms FROM keeper_stats WHERE id = 1").toArray()[0] as
    | { started_at?: number | null; max_gap_ms?: number }
    | undefined;
  const prior = previous?.at ?? null;
  const started = stats?.started_at ?? null;
  if (prior === null || started === null || prior < started) return;
  const gap = now - prior;
  const max = Number(stats?.max_gap_ms ?? 0);
  if (gap > max) sql.exec("UPDATE keeper_stats SET max_gap_ms = ? WHERE id = 1", gap);
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

function urlsOf(env: LifelineEnv): string[] {
  return env.RPC_URLS_TESTNET.split(",").map((url) => url.trim()).filter((url) => url.length > 0);
}

function keyAccount(key: string, label: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${label} key missing`);
  return privateKeyToAccount(key as Hex);
}

export async function runKeeper(sql: Sql, env: LifelineEnv, nowMs: number): Promise<void> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(env.OPERATOR_PK ?? "") || !/^0x[0-9a-fA-F]{64}$/.test(env.POOL_OWNER_PK ?? "")) return;
  const urls = urlsOf(env);
  const chain = openChain(TESTNET_ID, { urls, timeout: 8_000 });
  const client = chain.client;
  const confirmed = await confirmPending(sql, client);
  await restoreHouse(sql, env, confirmed, BigInt(Math.floor(nowMs / 1000)));
  await fundOperator(env, client);
  const paused = env.LIFELINE_PAUSED === "true" || env.LIFELINE_PAUSED === "1";
  const armed = sql
    .exec(
      `SELECT p.proxy, p.account_id, p.perp_id, p.role, m.typed_data, m.budget_used_cns, m.active
       FROM mandates m JOIN pool p ON p.proxy = m.proxy WHERE m.active = 1`,
    )
    .toArray() as unknown as ArmedRow[];
  if (armed.length === 0) return;
  const exchange = ADDRESSES[TESTNET_ID].exchange;
  const accounts = await chain.readAccounts(armed.map((row) => BigInt(row.account_id)));
  const byAccount = new Map(accounts.map((account) => [account.accountId.toString(), account]));
  const positions = await readPositions(client, exchange, armed);
  const markets = await readMarkets(client, exchange, [...new Set(armed.map((row) => row.perp_id))]);
  const openDist = sql
    .exec("SELECT id, proxy, perp_id FROM actions WHERE status = 'confirmed' AND dist_after IS NULL")
    .toArray() as { id: number; proxy: string; perp_id: string }[];
  for (const row of openDist) {
    const market = markets.get(row.perp_id);
    const position = positions.get(`${row.proxy}:${row.perp_id}`);
    if (!market || !position) continue;
    sql.exec("UPDATE actions SET dist_after = ? WHERE id = ?", distanceOf(toEvalPosition(position, market)).toString(), row.id);
  }
  const block = await client.getBlockNumber();
  const nowSec = BigInt(Math.floor(nowMs / 1000));
  const operator = keyAccount(env.OPERATOR_PK, "operator");
  let nonce = await operatorNonce(sql, client, operator.address);
  const wallet = createWalletClient({
    account: operator,
    chain: CHAINS[TESTNET_ID],
    transport: http(urls[0], { timeout: 8_000, retryCount: 1 }),
  });
  const pending = new Set(
    (sql.exec("SELECT proxy, perp_id FROM actions WHERE status = 'pending'").toArray() as { proxy: string; perp_id: string }[])
      .map((row) => `${row.proxy}:${row.perp_id}`),
  );
  for (const row of armed) {
    const key = `${row.proxy}:${row.perp_id}`;
    if (pending.has(key)) continue;
    const mandate = storedMandate(getAddress(row.proxy), row.typed_data);
    const market = markets.get(row.perp_id);
    const position = positions.get(key);
    const account = byAccount.get(row.account_id);
    const evalPosition = market && position ? toEvalPosition(position, market) : null;
    const last = lastActionBlock(sql, row.proxy, row.perp_id);
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
      const hash = await wallet.sendTransaction({
        account: operator,
        chain: wallet.chain,
        to: built.to,
        data: built.data,
        gas: built.gas,
        nonce: Number(nonce),
        value: built.value,
      });
      sql.exec(
        `INSERT INTO actions (proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason)
         VALUES (?, ?, ?, ?, NULL, ?, NULL, 'pending', ?)`,
        row.proxy,
        row.perp_id,
        decision.amountCNS.toString(),
        hash,
        decision.distBefore.toString(),
        capped ? "capped" : "",
      );
      sql.exec("UPDATE keys SET next_nonce = ? WHERE name = 'operator'", Number(nonce + 1n));
      nonce += 1n;
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

async function operatorNonce(sql: Sql, client: PublicClient, address: Address): Promise<bigint> {
  const row = sql.exec("SELECT next_nonce FROM keys WHERE name = 'operator'").toArray()[0] as
    | { next_nonce?: number }
    | undefined;
  if (row?.next_nonce !== undefined) return BigInt(row.next_nonce);
  const count = await client.getTransactionCount({ address, blockTag: "pending" });
  sql.exec("INSERT INTO keys (name, next_nonce) VALUES ('operator', ?)", count);
  return BigInt(count);
}

function lastActionBlock(sql: Sql, proxy: string, perpId: string): bigint | null {
  const row = sql
    .exec(
      "SELECT block FROM actions WHERE proxy = ? AND perp_id = ? AND status = 'confirmed' AND block IS NOT NULL ORDER BY id DESC LIMIT 1",
      proxy,
      perpId,
    )
    .toArray()[0] as { block?: number | null } | undefined;
  return row?.block === undefined || row.block === null ? null : BigInt(row.block);
}

async function confirmPending(sql: Sql, client: PublicClient): Promise<{ proxy: string; perp_id: string }[]> {
  const confirmed: { proxy: string; perp_id: string }[] = [];
  const rows = sql
    .exec("SELECT id, proxy, perp_id, tx_hash, amount_cns, reason FROM actions WHERE status = 'pending'")
    .toArray() as unknown as PendingRow[];
  for (const row of rows) {
    if (!row.tx_hash) {
      sql.exec("UPDATE keeper_stats SET nonce_errors = nonce_errors + 1 WHERE id = 1");
      continue;
    }
    try {
      const receipt = await client.getTransactionReceipt({ hash: row.tx_hash as Hex });
      if (receipt.status !== "success") {
        sql.exec("UPDATE actions SET status = 'reverted', block = ? WHERE id = ?", Number(receipt.blockNumber), row.id);
        sql.exec("UPDATE keeper_stats SET nonce_errors = nonce_errors + 1 WHERE id = 1");
        continue;
      }
      sql.exec(
        "UPDATE actions SET status = 'confirmed', block = ? WHERE id = ?",
        Number(receipt.blockNumber),
        row.id,
      );
      confirmed.push({ proxy: row.proxy, perp_id: row.perp_id });
      const mandate = sql.exec("SELECT budget_used_cns FROM mandates WHERE proxy = ?", row.proxy).toArray()[0] as
        | { budget_used_cns?: string }
        | undefined;
      const used = BigInt(mandate?.budget_used_cns || "0") + BigInt(row.amount_cns);
      sql.exec("UPDATE mandates SET budget_used_cns = ? WHERE proxy = ?", used.toString(), row.proxy);
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
        args: [BigInt(id), 1n] as const,
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
    entryMicro: priceToMicro(read.position.pricePNS, market.priceDecimals),
    lot: lotToScaled(read.position.lotLNS, market.lotDecimals),
    depositMicro: read.position.depositCNS,
    fundingMicro: read.position.premiumPnlCNS,
    mmf: market.mmf,
    markMicro: priceToMicro(read.markPNS, market.priceDecimals),
  };
}

export async function readDistances(
  env: LifelineEnv,
  rows: readonly { proxy: string; account_id: string; perp_id: string }[],
): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  if (rows.length === 0) return out;
  const chain = openChain(TESTNET_ID, { urls: urlsOf(env), timeout: 8_000 });
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
  const positions = await readPositions(chain.client, exchange, armed);
  const markets = await readMarkets(chain.client, exchange, [...new Set(rows.map((row) => row.perp_id))]);
  for (const row of rows) {
    const market = markets.get(row.perp_id);
    const position = positions.get(`${row.proxy}:${row.perp_id}`);
    if (!market || !position) continue;
    out.set(getAddress(row.proxy), distanceOf(toEvalPosition(position, market)));
  }
  return out;
}

export async function takeNonce(sql: Sql, client: PublicClient, name: string, address: Address): Promise<number> {
  const row = sql.exec("SELECT next_nonce FROM keys WHERE name = ?", name).toArray()[0] as
    | { next_nonce?: number }
    | undefined;
  if (row?.next_nonce === undefined) {
    const count = await client.getTransactionCount({ address, blockTag: "pending" });
    sql.exec("INSERT INTO keys (name, next_nonce) VALUES (?, ?)", name, count + 1);
    return count;
  }
  const nonce = Number(row.next_nonce);
  sql.exec("UPDATE keys SET next_nonce = ? WHERE name = ?", nonce + 1, name);
  return nonce;
}

export function distanceOf(position: EvalPosition): bigint {
  return distanceE6(
    position.side,
    position.markMicro,
    liquidationPriceMicro({
      side: position.side,
      entryMicro: position.entryMicro,
      lot: position.lot,
      depositMicro: position.depositMicro,
      fundingMicro: position.fundingMicro,
      mmf: position.mmf,
    }),
  );
}

export async function armBreach(sql: Sql, env: LifelineEnv, proxy: Address, nowSec: bigint): Promise<{ triggerBps: number; targetBps: number }> {
  const row = sql
    .exec("SELECT account_id, perp_id, role FROM pool WHERE proxy = ?", proxy)
    .toArray()[0] as { account_id?: string; perp_id?: string; role?: string } | undefined;
  if (!row?.account_id || !row.perp_id || !row.role) throw new Error("proxy not registered");
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
  return terms;
}

export async function restoreHouse(
  sql: Sql,
  env: LifelineEnv,
  confirmed: readonly { proxy: string; perp_id: string }[],
  nowSec: bigint,
) {
  const rows = sql
    .exec(
      `SELECT p.proxy, p.perp_id, p.role, m.kind FROM mandates m
       JOIN pool p ON p.proxy = m.proxy WHERE m.active = 1 AND m.kind = 'breach'`,
    )
    .toArray() as { proxy: string; perp_id: string; role: string; kind: string }[];
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
  }
}

export function soakReport(sql: Sql) {
  const stats = sql.exec("SELECT max_gap_ms, nonce_errors, started_at FROM keeper_stats WHERE id = 1").toArray()[0] as
    | { max_gap_ms?: number; nonce_errors?: number; started_at?: number | null }
    | undefined;
  const pending = sql.exec("SELECT COUNT(*) AS n FROM actions WHERE status = 'pending'").toArray()[0] as { n?: number } | undefined;
  const armed = sql.exec("SELECT COUNT(*) AS n FROM mandates WHERE active = 1").toArray()[0] as { n?: number } | undefined;
  const kinds = sql
    .exec("SELECT status, reason, COUNT(*) AS n FROM actions GROUP BY status, reason")
    .toArray() as { status: string; reason: string; n: number }[];
  const health = sql.exec("SELECT last_error FROM health_state WHERE id = 1").toArray()[0] as
    | { last_error?: string | null }
    | undefined;
  const recent = sql
    .exec(
      `SELECT proxy, perp_id, amount_cns, tx_hash, block, dist_before, dist_after, status, reason
       FROM actions ORDER BY id DESC LIMIT 20`,
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
