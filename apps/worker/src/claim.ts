import {
  CHAINS,
  GAS_LIMITS,
  MON_DRIP_WEI,
  TESTNET_ID,
  monDripTx,
  openChain,
  transferOwnershipTx,
} from "@lifeline/core";
import { createWalletClient, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { LifelineEnv } from "./lifeline.js";
import { addressFromWalletProof, verifyPrivyAccessToken } from "./privy.js";
import type { Sql } from "./schema.js";
import { readDistances, takeNonce } from "./tick.js";

/** 1.5% in distance units. 1e6 is 100%. */
export const HOUSE_TRIGGER_E6 = 15_000n;
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
}

export function pickPool(rows: readonly PoolCandidate[]): PoolCandidate | null {
  const eligible = rows.filter((row) => row.distanceE6 > HOUSE_TRIGGER_E6);
  const btc = eligible.filter((row) => row.market === "BTC");
  const pool = btc.length > 0 ? btc : eligible;
  const ranked = [...pool].sort((left, right) => {
    if (left.distanceE6 < right.distanceE6) return -1;
    if (left.distanceE6 > right.distanceE6) return 1;
    return 0;
  });
  return ranked[0] ?? null;
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
}

export async function claimPosition(
  sql: Sql,
  env: LifelineEnv,
  claimant: Claimant,
  nowMs: number,
): Promise<Response> {
  const userRow = sql.exec("SELECT proxy FROM claims WHERE privy_user_id = ?", claimant.userId).toArray()[0];
  const ipRow = sql
    .exec("SELECT COUNT(*) AS n FROM claims WHERE ip = ? AND claimed_at >= ?", claimant.ip, nowMs - HOUR_MS)
    .toArray()[0] as { n?: number } | undefined;
  const available = sql
    .exec("SELECT proxy, account_id, perp_id, side, leverage, market FROM pool WHERE status = 'available' AND role = 'pool'")
    .toArray() as unknown as AvailableRow[];
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
    sendTx(urls[0] ?? "", sponsor, drip, sponsorNonce),
    sendTx(urls[0] ?? "", owner, transfer, ownerNonce),
  ]);
  const [dripReceipt, transferReceipt] = await Promise.all([
    client.waitForTransactionReceipt({ hash: dripHash }),
    client.waitForTransactionReceipt({ hash: transferHash }),
  ]);
  if (dripReceipt.status !== "success" || transferReceipt.status !== "success") {
    return Response.json({ error: "reverted" }, { status: 500 });
  }
  sql.exec("UPDATE pool SET status = 'claimed' WHERE proxy = ? AND status = 'available'", picked.proxy);
  sql.exec(
    `INSERT INTO claims (proxy, privy_user_id, owner, ip, claimed_at, accepted_at) VALUES (?, ?, ?, ?, ?, NULL)`,
    picked.proxy,
    claimant.userId,
    claimant.address,
    claimant.ip,
    nowMs,
  );
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

async function sendTx(
  url: string,
  account: ReturnType<typeof privateKeyToAccount>,
  built: { to: Address; data: Hex; gas: bigint; value: bigint },
  nonce: number,
): Promise<Hex> {
  const wallet = createWalletClient({
    account,
    chain: CHAINS[TESTNET_ID],
    transport: http(url, { timeout: 8_000, retryCount: 1 }),
  });
  return wallet.sendTransaction({
    account,
    chain: wallet.chain,
    to: built.to,
    data: built.data,
    gas: built.gas,
    nonce,
    value: built.value,
  });
}
