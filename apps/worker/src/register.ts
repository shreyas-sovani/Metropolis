import type { Address, Hex } from "viem";
import type { MandateMessage } from "@lifeline/core";
import { dropMandate, putMandate, registrationCounts, upsertPool, type HotState } from "./hot.js";
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
  hot?: HotState | null,
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
         status = CASE WHEN pool.status = 'claimed' AND ? = 0 THEN pool.status ELSE excluded.status END`,
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
      entry.reopen ? 1 : 0,
    );
    upsertPool(
      hot,
      {
        proxy: entry.proxy,
        account_id: entry.accountId,
        perp_id: entry.perpId,
        side: entry.side,
        leverage: entry.leverage,
        status: poolStatus(entry.role),
        market: entry.market,
        role: entry.role,
        pair_id: entry.pairId,
      },
      Boolean(entry.reopen),
    );
    if (entry.reopen) sql.exec("DELETE FROM claims WHERE proxy = ?", entry.proxy);
    const message = houseMandate({
      account: entry.proxy,
      perpId: BigInt(entry.perpId),
      role: entry.role,
      nowSec,
    });
    if (!message) {
      sql.exec("DELETE FROM mandates WHERE proxy = ?", entry.proxy);
      dropMandate(hot, entry.proxy);
      continue;
    }
    const already =
      hot?.loaded === true
        ? hot.mandates.some((row) => row.proxy === entry.proxy && row.active === 1)
        : activeMandate(sql, entry.proxy);
    if (already && !entry.replaceMandate) continue;
    const signed = await sign(message);
    const previous = hot?.mandates.find((row) => row.proxy === entry.proxy);
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
    putMandate(hot, {
      proxy: entry.proxy,
      owner: signed.owner,
      typed_data: serializeMandate(message),
      sig: signed.sig,
      active: 1,
      budget_used_cns: previous?.budget_used_cns ?? "0",
      kind: "house",
    });
  }
  return (
    registrationCounts(hot) ?? {
      registered: count(sql, "SELECT COUNT(*) AS n FROM pool"),
      mandates: count(sql, "SELECT COUNT(*) AS n FROM mandates WHERE active = 1 AND kind = 'house'"),
    }
  );
}
