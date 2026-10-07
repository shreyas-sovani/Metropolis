import {
  GAS_LIMITS,
  MON_DRIP_WEI,
  TESTNET_ID,
  monDripTx,
  openChain,
  transferOwnershipTx,
} from "@lifeline/core";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { addOpenClaim, markClaimed, type HotState } from "./hot.js";
import type { LifelineEnv } from "./lifeline.js";
import { addressFromWalletProof, verifyPrivyAccessToken } from "./privy.js";
import type { Sql } from "./schema.js";
import { broadcastTx, readDistances, takeNonce, waitForReceipt } from "./tick.js";

/** 1.5% in distance units. 1e6 is 100%. */
export const HOUSE_TRIGGER_E6 = 15_000n;
/** House target is 2.5%. The demo band runs from there through 3.5%. */
export const HOUSE_TARGET_E6 = 25_000n;
export const DEMO_BAND_HIGH_E6 = 35_000n;
/** Above 6% the position is still offered, but only after every closer account. */
export const RESERVE_DISTANCE_E6 = 60_000n;
const HOUR_MS = 60 * 60 * 1000;
const IP_LIMIT = 3;

export interface PoolCandidate {
  proxy: Address;
  market: string;
  perpId: string;
  accountId: string;
  side: string;
  leverage: string;
  distanceE6: bigint;
  reserve?: boolean;
}

function rankPool(rows: readonly PoolCandidate[]): PoolCandidate | null {
  const btc = rows.filter((row) => row.market === "BTC");
  const pool = btc.length > 0 ? btc : [...rows];
  const ranked = [...pool].sort((left, right) => {
    if (left.distanceE6 < right.distanceE6) return -1;
    if (left.distanceE6 > right.distanceE6) return 1;
    return 0;
  });
  return ranked[0] ?? null;
}

export function pickPool(rows: readonly PoolCandidate[]): PoolCandidate | null {
  const eligible = rows.filter((row) => row.distanceE6 > HOUSE_TRIGGER_E6);
  const fresh = eligible.filter((row) => !row.reserve && row.distanceE6 <= RESERVE_DISTANCE_E6);
  const band = fresh.filter((row) => row.distanceE6 >= HOUSE_TARGET_E6 && row.distanceE6 <= DEMO_BAND_HIGH_E6);
  const source = band.length > 0 ? band : fresh.length > 0 ? fresh : eligible;
  return rankPool(source);
}

export type ClaimGate = { ok: true } | { ok: false; status: 409 | 429 | 503; body: { error: string; sandbox?: boolean } };

export function claimGate(input: { existingUser: boolean; ipCount: number; available: number }): ClaimGate {
  if (input.existingUser) return { ok: false, status: 409, body: { error: "claimed" } };
  if (input.ipCount >= IP_LIMIT) return { ok: false, status: 429, body: { error: "rate" } };
  if (input.available <= 0) return { ok: false, status: 503, body: { error: "empty", sandbox: true } };
  return { ok: true };
}

export interface Claimant {
  userId: string;
  address: Address;
  ip: string;
}

export async function readClaimant(request: Request, env: LifelineEnv): Promise<Claimant | Response> {
  const admin = Boolean(env.ADMIN_SECRET) && request.headers.get("x-admin-secret") === env.ADMIN_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  let userId: string | null = null;
  if (admin && request.headers.get("x-lifeline-user")) {
    userId = request.headers.get("x-lifeline-user");
  } else if (token) {
    const verified = await verifyPrivyAccessToken(token, {
      verificationKey: env.PRIVY_VERIFICATION_KEY,
      appId: env.PRIVY_APP_ID,
    });
    if (!verified.ok) return Response.json({ error: "unauthorized" }, { status: 401 });
    userId = verified.identity.userId;
  }
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const wallet = request.headers.get("x-lifeline-address");
  const signature = request.headers.get("x-lifeline-signature");
  const nonce = request.headers.get("x-lifeline-nonce");
  if (!wallet || !signature || !nonce) return Response.json({ error: "unauthorized" }, { status: 401 });
  const address = await addressFromWalletProof({
    userId,
    address: wallet,
    nonce,
    signature: signature as Hex,
  });
  if (!address) return Response.json({ error: "unauthorized" }, { status: 401 });
  const override = request.headers.get("x-lifeline-ip");
  const ip = admin && override
    ? override
    : request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
  return { userId, address: getAddress(address), ip };
}

interface AvailableRow {
  proxy: string;
  account_id: string;
  perp_id: string;
  side: string;
  leverage: string;
  market: string;
  status: string;
}

export async function claimPosition(
  sql: Sql,
  env: LifelineEnv,
  claimant: Claimant,
  nowMs: number,
  hot?: HotState | null,
): Promise<Response> {
  const userRow = sql.exec("SELECT proxy FROM claims WHERE privy_user_id = ?", claimant.userId).toArray()[0];
  const ipRow = sql
    .exec("SELECT COUNT(*) AS n FROM claims WHERE ip = ? AND claimed_at >= ?", claimant.ip, nowMs - HOUR_MS)
    .toArray()[0] as { n?: number } | undefined;
  const available = (
    hot?.loaded
      ? hot.pools.filter((row) => (row.status === "available" || row.status === "reserve") && row.role === "pool")
      : (sql
          .exec(
            "SELECT proxy, account_id, perp_id, side, leverage, market, status FROM pool WHERE status IN ('available', 'reserve') AND role = 'pool'",
          )
          .toArray() as unknown as AvailableRow[])
  ) as AvailableRow[];
  const gate = claimGate({
    existingUser: Boolean(userRow),
    ipCount: Number(ipRow?.n ?? 0),
    available: available.length,
  });
  if (!gate.ok) return Response.json(gate.body, { status: gate.status });

  const distances = await readDistances(
    env,
    available.map((row) => ({ proxy: row.proxy, account_id: row.account_id, perp_id: row.perp_id })),
  );
  const picked = pickPool(
    available.map((row) => ({
      proxy: getAddress(row.proxy),
      market: row.market,
      perpId: row.perp_id,
      accountId: row.account_id,
      side: row.side,
      leverage: row.leverage,
      distanceE6: distances.get(getAddress(row.proxy)) ?? 0n,
      reserve: row.status === "reserve",
    })),
  );
  if (!picked) return Response.json({ error: "empty", sandbox: true }, { status: 503 });

  const urls = env.RPC_URLS_TESTNET.split(",").map((url) => url.trim()).filter((url) => url.length > 0);
  const client = openChain(TESTNET_ID, { urls, timeout: 8_000 }).client;
  const sponsor = keyAccount(env.SPONSOR_PK, "sponsor");
  const owner = keyAccount(env.POOL_OWNER_PK, "pool owner");
  const sponsorBal = await client.getBalance({ address: sponsor.address });
  const dripGas = GAS_LIMITS.monDrip ?? 36_000n;
  const fee = dripGas * 100_000_000_000n;
  if (sponsorBal < 3n * 10n ** 18n + MON_DRIP_WEI + fee) {
    return Response.json({ error: "sponsor floor" }, { status: 503 });
  }
  const drip = monDripTx(claimant.address, MON_DRIP_WEI);
  const transfer = transferOwnershipTx(picked.proxy, claimant.address);
  const sponsorNonce = await takeNonce(sql, client, "sponsor", sponsor.address);
  const ownerNonce = await takeNonce(sql, client, "pool-owner", owner.address);
  const [dripHash, transferHash] = await Promise.all([
    broadcastTx(urls, sponsor, { ...drip, nonce: sponsorNonce }),
    broadcastTx(urls, owner, { ...transfer, nonce: ownerNonce }),
  ]);
  const dripReceipt = await waitForReceipt(client, dripHash).catch(() => null);
  const transferReceipt = await waitForReceipt(client, transferHash).catch(() => null);
  if ((dripReceipt && dripReceipt.status !== "success") || (transferReceipt && transferReceipt.status !== "success")) {
    return Response.json({ error: "reverted", txs: { drip: dripHash, transfer: transferHash } }, { status: 500 });
  }
  sql.exec("UPDATE pool SET status = 'claimed' WHERE proxy = ? AND status = 'available'", picked.proxy);
  markClaimed(hot, picked.proxy);
  sql.exec(
    `INSERT INTO claims (proxy, privy_user_id, owner, ip, claimed_at, accepted_at) VALUES (?, ?, ?, ?, ?, NULL)`,
    picked.proxy,
    claimant.userId,
    claimant.address,
    claimant.ip,
    nowMs,
  );
  addOpenClaim(hot, { proxy: picked.proxy, claimed_at: nowMs });
  return Response.json({
    proxy: picked.proxy,
    perpId: picked.perpId,
    accountId: picked.accountId,
    txs: { drip: dripHash, transfer: transferHash },
    position: {
      market: picked.market,
      side: picked.side,
      leverage: picked.leverage,
      distanceE6: picked.distanceE6.toString(),
    },
  });
}

function keyAccount(key: string, label: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${label} key missing`);
  return privateKeyToAccount(key as Hex);
}
