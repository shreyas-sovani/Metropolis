import type { Address, Hex } from "viem";
import type { MandateMessage } from "@lifeline/core";
import { houseMandate, poolStatus, serializeMandate, type PoolRegistration } from "./house.js";
import type { Sql } from "./schema.js";

export interface RegistrationCounts {
  registered: number;
  mandates: number;
}

function count(sql: Sql, query: string): number {
  const row = sql.exec(query).toArray()[0] as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

function activeMandate(sql: Sql, proxy: Address): boolean {
  const row = sql.exec("SELECT active FROM mandates WHERE proxy = ?", proxy).toArray()[0] as
    | { active?: number }
    | undefined;
  return Number(row?.active) === 1;
}

export async function registerPool(
  sql: Sql,
  entries: readonly PoolRegistration[],
  sign: (message: MandateMessage) => Promise<{ owner: Address; sig: Hex }>,
  nowSec: bigint,
): Promise<RegistrationCounts> {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.proxy)) throw new Error(`duplicate proxy ${entry.proxy}`);
    seen.add(entry.proxy);
    sql.exec(
      `INSERT INTO pool (proxy, account_id, perp_id, side, leverage, status, created_at, market, role, pair_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(proxy) DO UPDATE SET
         account_id = excluded.account_id,
         perp_id = excluded.perp_id,
         side = excluded.side,
         leverage = excluded.leverage,
         market = excluded.market,
         role = excluded.role,
         pair_id = excluded.pair_id,
         status = CASE WHEN pool.status = 'claimed' THEN pool.status ELSE excluded.status END`,
      entry.proxy,
      entry.accountId,
      entry.perpId,
      entry.side,
      entry.leverage,
      poolStatus(entry.role),
      Number(nowSec),
      entry.market,
      entry.role,
      entry.pairId,
    );
    const message = houseMandate({
      account: entry.proxy,
      perpId: BigInt(entry.perpId),
      role: entry.role,
      nowSec,
    });
    if (!message) {
      sql.exec("DELETE FROM mandates WHERE proxy = ?", entry.proxy);
      continue;
    }
    if (activeMandate(sql, entry.proxy)) continue;
    const signed = await sign(message);
    sql.exec(
      `INSERT INTO mandates (proxy, owner, typed_data, sig, active, budget_used_cns, kind)
       VALUES (?, ?, ?, ?, 1, '0', 'house')
       ON CONFLICT(proxy) DO UPDATE SET
         owner = excluded.owner,
         typed_data = excluded.typed_data,
         sig = excluded.sig,
         active = 1,
         kind = 'house'`,
      entry.proxy,
      signed.owner,
      serializeMandate(message),
      signed.sig,
    );
  }
  return {
    registered: count(sql, "SELECT COUNT(*) AS n FROM pool"),
    mandates: count(sql, "SELECT COUNT(*) AS n FROM mandates WHERE active = 1 AND kind = 'house'"),
  };
}
