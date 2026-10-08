import { TESTNET_ID, delegatedAccountAbi, openChain } from "@lifeline/core";
import { getAddress, type Address } from "viem";
import { acceptCached, type HotState } from "./hot.js";
import type { LifelineEnv } from "./lifeline.js";
import type { Sql } from "./schema.js";

export interface OwnerRead {
  owner: string;
  pendingOwner: string;
}

export function acceptedStamp(
  current: number | null,
  claimOwner: string,
  onchainOwner: string,
  now: number,
): number | null {
  if (current != null) return null;
  try {
    if (getAddress(claimOwner) !== getAddress(onchainOwner)) return null;
  } catch {
    return null;
  }
  return now;
}

/** Writes `accepted_at` once, when the on-chain owner is the claim owner. */
export function stampAccepted(sql: Sql, proxy: string, onchainOwner: string, now: number, hot?: HotState | null): void {
  const row = sql.exec("SELECT owner, accepted_at FROM claims WHERE proxy = ?", proxy).toArray()[0] as
    | { owner?: string; accepted_at?: number | null }
    | undefined;
  if (!row?.owner) return;
  const stamp = acceptedStamp(row.accepted_at == null ? null : Number(row.accepted_at), row.owner, onchainOwner, now);
  if (stamp == null) return;
  sql.exec("UPDATE claims SET accepted_at = ? WHERE proxy = ? AND accepted_at IS NULL", stamp, proxy);
  acceptCached(hot, proxy);
}

export function mePayload(input: {
  userId: string;
  claim: null | {
    proxy: string;
    perpId: string;
    accountId: string;
    market: string;
    side: string;
    leverage: string;
    claimedAt: number;
    acceptedAt: number | null;
    transferTx: string | null;
    dripTx: string | null;
    acceptTx: string | null;
    ownerOnchain: string | null;
    pendingOwnerOnchain: string | null;
  };
  mandate: null | {
    kind: string;
    active: boolean;
    triggerBps: number;
    targetBps: number;
    maxPerActionCNS: string;
    budgetCNS: string;
    budgetUsedCNS: string;
    expiry: string;
  };
}) {
  return { userId: input.userId, claim: input.claim, mandate: input.mandate };
}

async function defaultOwners(env: LifelineEnv, proxy: Address): Promise<OwnerRead | null> {
  const endpoint = env.RPC_URLS_TESTNET.split(",").map((url) => url.trim()).find((url) => url.length > 0);
  if (!endpoint) return null;
  const client = openChain(TESTNET_ID, { urls: [endpoint], timeout: 8_000 }).client;
  const packed = await client.multicall({
    contracts: [
      { address: proxy, abi: delegatedAccountAbi, functionName: "owner" },
      { address: proxy, abi: delegatedAccountAbi, functionName: "pendingOwner" },
    ],
    allowFailure: false,
  });
  return { owner: getAddress(packed[0] as Address), pendingOwner: getAddress(packed[1] as Address) };
}

function mandateOf(raw: string): {
  triggerBps: number;
  targetBps: number;
  maxPerActionCNS: string;
  budgetCNS: string;
  expiry: string;
} | null {
  try {
    const parsed = JSON.parse(raw) as {
      triggerBps?: number;
      targetBps?: number;
      maxPerActionCNS?: string;
      budgetCNS?: string;
      expiry?: string;
    };
    if (parsed.triggerBps == null || parsed.targetBps == null) return null;
    return {
      triggerBps: Number(parsed.triggerBps),
      targetBps: Number(parsed.targetBps),
      maxPerActionCNS: parsed.maxPerActionCNS ?? "0",
      budgetCNS: parsed.budgetCNS ?? "0",
      expiry: parsed.expiry ?? "0",
    };
  } catch {
    return null;
  }
}

export async function meFor(
  sql: Sql,
  env: LifelineEnv,
  userId: string,
  now: number,
  readOwners: (env: LifelineEnv, proxy: Address) => Promise<OwnerRead | null> = defaultOwners,
  hot?: HotState | null,
): Promise<Response> {
  const claim = sql
    .exec(
      `SELECT claims.proxy, claims.owner, claims.claimed_at, claims.accepted_at, claims.transfer_tx, claims.drip_tx, claims.accept_tx,
              pool.perp_id, pool.account_id, pool.market, pool.side, pool.leverage
       FROM claims JOIN pool ON pool.proxy = claims.proxy
       WHERE claims.privy_user_id = ?`,
      userId,
    )
    .toArray()[0] as
    | {
        proxy?: string;
        owner?: string;
        claimed_at?: number;
        accepted_at?: number | null;
        transfer_tx?: string | null;
        drip_tx?: string | null;
        accept_tx?: string | null;
        perp_id?: string;
        account_id?: string;
        market?: string;
        side?: string;
        leverage?: string;
      }
    | undefined;
  if (!claim?.proxy) return Response.json(mePayload({ userId, claim: null, mandate: null }));
  let owners: OwnerRead | null = null;
  try {
    owners = await readOwners(env, getAddress(claim.proxy));
  } catch {
    owners = null;
  }
  if (owners) stampAccepted(sql, claim.proxy, owners.owner, now, hot);
  const refreshed = sql.exec("SELECT accepted_at FROM claims WHERE proxy = ?", claim.proxy).toArray()[0] as
    | { accepted_at?: number | null }
    | undefined;
  const mandateRow = sql
    .exec("SELECT typed_data, active, budget_used_cns, kind FROM mandates WHERE proxy = ?", claim.proxy)
    .toArray()[0] as { typed_data?: string; active?: number; budget_used_cns?: string; kind?: string } | undefined;
  const fields = mandateRow?.typed_data ? mandateOf(mandateRow.typed_data) : null;
  const mandate =
    mandateRow && fields
      ? {
          kind: mandateRow.kind ?? "",
          active: Number(mandateRow.active) === 1,
          triggerBps: fields.triggerBps,
          targetBps: fields.targetBps,
          maxPerActionCNS: fields.maxPerActionCNS,
          budgetCNS: fields.budgetCNS,
          budgetUsedCNS: mandateRow.budget_used_cns ?? "0",
          expiry: fields.expiry,
        }
      : null;
  return Response.json(
    mePayload({
      userId,
      claim: {
        proxy: claim.proxy,
        perpId: claim.perp_id ?? "",
        accountId: claim.account_id ?? "",
        market: claim.market ?? "",
        side: claim.side ?? "",
        leverage: claim.leverage ?? "",
        claimedAt: Number(claim.claimed_at ?? 0),
        acceptedAt: refreshed?.accepted_at == null ? null : Number(refreshed.accepted_at),
        transferTx: claim.transfer_tx ?? null,
        dripTx: claim.drip_tx ?? null,
        acceptTx: claim.accept_tx ?? null,
        ownerOnchain: owners?.owner ?? null,
        pendingOwnerOnchain: owners?.pendingOwner ?? null,
      },
      mandate,
    }),
  );
}

export function storeAcceptTx(sql: Sql, userId: string, txHash: string): Response {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return Response.json({ error: "tx" }, { status: 400 });
  const claim = sql.exec("SELECT proxy FROM claims WHERE privy_user_id = ?", userId).toArray()[0] as { proxy?: string } | undefined;
  if (!claim?.proxy) return Response.json({ error: "claimed" }, { status: 404 });
  sql.exec("UPDATE claims SET accept_tx = ? WHERE proxy = ?", txHash, claim.proxy);
  return Response.json({ proxy: claim.proxy, acceptTx: txHash });
}
