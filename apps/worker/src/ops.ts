import { TESTNET_ID, openChain } from "@lifeline/core";
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEMO_BAND_HIGH_E6, HOUSE_TARGET_E6 } from "./claim.js";
import { countBySide, countInBand, type PoolBySide } from "./health.js";
import type { LifelineEnv } from "./lifeline.js";
import type { Sql } from "./schema.js";
import { readDistances, urlsOf } from "./tick.js";

export const OPS_TTL_MS = 60_000;

export interface OpsSnapshot {
  at: number;
  sponsorWei: bigint;
  operatorWei: bigint;
  poolInBand: number;
  poolBySide: PoolBySide;
}

export function opsDue(lastAt: number | null, now: number): boolean {
  return lastAt === null || now - lastAt >= OPS_TTL_MS;
}

function accountOf(key: string | undefined) {
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  return privateKeyToAccount(key as Hex);
}

/** Balances and the demo band for available pool rows. Null when the role keys are absent. */
export async function readOps(sql: Sql, env: LifelineEnv, now: number): Promise<OpsSnapshot | null> {
  const sponsor = accountOf(env.SPONSOR_PK);
  const operator = accountOf(env.OPERATOR_PK);
  if (!sponsor || !operator || urlsOf(env).length === 0) return null;
  const rows = sql
    .exec("SELECT proxy, account_id, perp_id, side FROM pool WHERE status = 'available'")
    .toArray() as { proxy?: string; account_id?: string; perp_id?: string; side?: string }[];
  const readable = rows.flatMap((row) => {
    if (!row.proxy || !row.account_id || !row.perp_id) return [];
    return [{ proxy: row.proxy, account_id: String(row.account_id), perp_id: String(row.perp_id) }];
  });
  const client = openChain(TESTNET_ID, { urls: urlsOf(env), timeout: 8_000 }).client;
  const [sponsorWei, operatorWei, distances] = await Promise.all([
    client.getBalance({ address: sponsor.address }),
    client.getBalance({ address: operator.address }),
    readDistances(env, readable),
  ]);
  const band = readable.flatMap((row) => {
    const distance = distances.get(getAddress(row.proxy));
    return distance === undefined ? [] : [distance];
  });
  return {
    at: now,
    sponsorWei,
    operatorWei,
    poolInBand: countInBand(band, HOUSE_TARGET_E6, DEMO_BAND_HIGH_E6),
    poolBySide: countBySide(rows.map((row) => row.side ?? "")),
  };
}
