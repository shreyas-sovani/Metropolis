import {
  TESTNET_ID,
  buildMandate,
  delegatedAccountAbi,
  contractDistanceE6,
  desiredDepositMicro,
  evalQuote,
  evaluate,
  increasePositionCollateralTx,
  liquidationMicroFromContract,
  openChain,
  recoverSigner,
  validateMandate,
  type MandateMessage,
} from "@lifeline/core";
import { getAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Claimant } from "./claim.js";
import { stampAccepted } from "./me.js";
import {
  cachedBlock,
  confirmInflight,
  forgetInflight,
  hashInflight,
  insertAction,
  noteDistanceHash,
  putMandate,
  setBudget,
  type HotState,
} from "./hot.js";
import { serializeMandate } from "./house.js";
import type { LifelineEnv } from "./lifeline.js";
import type { Sql } from "./schema.js";
import { broadcastTx, readAccountState, takeNonce, waitForReceipt } from "./tick.js";

/** EIP-191. The owner signs this; it is not the mandate typed data. */
export function disarmMessage(proxy: Address, nonce: string): string {
  return `lifeline-disarm:${getAddress(proxy)}:${nonce}`;
}

interface MandateBody {
  account?: string;
  perpIds?: string[];
  triggerBps?: number;
  targetBps?: number;
  maxPerActionCNS?: string;
  budgetCNS?: string;
  expiry?: string;
  nonce?: string;
}

export function mandateFromBody(body: MandateBody): MandateMessage {
  if (!body.account || !body.perpIds || body.perpIds.length === 0) throw new Error("mandate");
  return buildMandate({
    account: getAddress(body.account),
    perpIds: body.perpIds.map((id) => BigInt(id)),
    triggerBps: Number(body.triggerBps),
    targetBps: Number(body.targetBps),
    maxPerActionCNS: BigInt(body.maxPerActionCNS ?? "0"),
    budgetCNS: BigInt(body.budgetCNS ?? "0"),
    expiry: BigInt(body.expiry ?? "0"),
    nonce: BigInt(body.nonce ?? "0"),
  });
}

function nonceUsed(sql: Sql, proxy: Address, nonce: bigint): boolean {
  const saved = sql.exec("SELECT nonce FROM mandate_nonces WHERE proxy = ? AND nonce = ?", proxy, nonce.toString()).toArray()[0];
  if (saved) return true;
  const current = sql.exec("SELECT typed_data FROM mandates WHERE proxy = ?", proxy).toArray()[0] as
    | { typed_data?: string }
    | undefined;
  if (!current?.typed_data) return false;
  const parsed = JSON.parse(current.typed_data) as { nonce?: string };
  return parsed.nonce === nonce.toString();
}

export async function armPosition(
  sql: Sql,
  env: LifelineEnv,
  claimant: Claimant,
  request: { mandate: MandateBody; signature: Hex },
  startedMs: number,
  hot?: HotState | null,
): Promise<Response> {
  const message = mandateFromBody(request.mandate);
  const signer = await recoverSigner(message, request.signature);
  // The mandate account is the proxy. The session wallet is its owner.
  if (getAddress(signer) !== claimant.address) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const pool = hot?.loaded
    ? hot.pools.find((row) => row.proxy === message.account)
    : (sql.exec("SELECT account_id, perp_id FROM pool WHERE proxy = ?", message.account).toArray()[0] as
        | { account_id?: string; perp_id?: string }
        | undefined);
  if (!pool?.account_id || !pool.perp_id) return Response.json({ error: "not found" }, { status: 404 });
  if (nonceUsed(sql, message.account, message.nonce)) return Response.json({ error: "nonce" }, { status: 409 });
  const nowSec = BigInt(Math.floor(startedMs / 1000));
  const verdict = validateMandate(message, {
    nowSec,
    accountPerpIds: [BigInt(pool.perp_id)],
    usedNonces: [],
  });
  if (!verdict.ok) {
    const status = verdict.reason === "nonce" ? 409 : 400;
    return Response.json({ error: verdict.reason }, { status });
  }
  const urls = env.RPC_URLS_TESTNET.split(",").map((url) => url.trim()).filter((url) => url.length > 0);
  const client = openChain(TESTNET_ID, { urls, timeout: 8_000 }).client;
  const owner = await client.readContract({ address: message.account, abi: delegatedAccountAbi, functionName: "owner" });
  if (getAddress(owner) !== signer) return Response.json({ error: "forbidden" }, { status: 403 });
  stampAccepted(sql, message.account, getAddress(owner), startedMs, hot);

  const state = await readAccountState(env, { proxy: message.account, account_id: pool.account_id, perp_id: pool.perp_id });
  const paused = env.LIFELINE_PAUSED === "true" || env.LIFELINE_PAUSED === "1";
  const last = hot?.loaded
    ? cachedBlock(hot, message.account, pool.perp_id)
    : (() => {
        const row = sql
          .exec(
            "SELECT block FROM actions WHERE proxy = ? AND perp_id = ? AND status = 'confirmed' AND block IS NOT NULL ORDER BY id DESC LIMIT 1",
            message.account,
            pool.perp_id,
          )
          .toArray()[0] as { block?: number | null } | undefined;
        return row?.block === undefined || row.block === null ? null : BigInt(row.block);
      })();
  const decision = evaluate(
    message,
    state?.position ?? null,
    { freeBalanceMicro: state?.freeCNS ?? 0n, paused, nowSec },
    last,
    state?.block ?? 0n,
    0n,
  );
  sql.exec(
    `INSERT INTO mandates (proxy, owner, typed_data, sig, active, budget_used_cns, kind)
     VALUES (?, ?, ?, ?, 1, '0', 'user')
     ON CONFLICT(proxy) DO UPDATE SET
       owner = excluded.owner,
       typed_data = excluded.typed_data,
       sig = excluded.sig,
       active = 1,
       budget_used_cns = '0',
       kind = 'user'`,
    message.account,
    signer,
    serializeMandate(message),
    request.signature,
  );
  putMandate(hot, {
    proxy: message.account,
    owner: signer,
    typed_data: serializeMandate(message),
    sig: request.signature,
    active: 1,
    budget_used_cns: "0",
    kind: "user",
  });
  sql.exec("INSERT OR IGNORE INTO mandate_nonces (proxy, nonce) VALUES (?, ?)", message.account, message.nonce.toString());
  if (!state || decision.action === "skip") {
    return Response.json({ skipped: true, reason: decision.action === "skip" ? decision.reason : "MARK_INVALID" });
  }
  const quote = evalQuote(state.position);
  const desired = desiredDepositMicro({
    side: state.position.side,
    entryMicro: state.position.entryMicro,
    lot: state.position.lot,
    fundingMicro: state.position.fundingMicro,
    mmf: state.position.mmf,
    markMicro: state.position.markMicro,
    targetBps: BigInt(message.targetBps),
  });
  const rawAdd = desired > state.position.depositMicro ? desired - state.position.depositMicro : 0n;
  const reason = decision.amountCNS < rawAdd ? "capped" : "";
  const liqBefore = liquidationMicroFromContract(quote.position, quote.market);
  insertAction(sql, hot, {
    proxy: message.account,
    perp_id: pool.perp_id,
    amount_cns: decision.amountCNS.toString(),
    tx_hash: "inflight",
    dist_before: decision.distBefore.toString(),
    status: "pending",
    reason,
    liq_before: null,
    created_at: startedMs,
  });
  const built = increasePositionCollateralTx(message.account, BigInt(pool.perp_id), decision.amountCNS);
  const operator = privateKeyToAccount(env.OPERATOR_PK as Hex);
  let hash: Hex;
  try {
    const nonce = await takeNonce(sql, client, "operator", operator.address);
    hash = await broadcastTx(urls, operator, { to: built.to, data: built.data, gas: built.gas, value: 0n, nonce });
  } catch (error) {
    sql.exec("DELETE FROM actions WHERE proxy = ? AND tx_hash = 'inflight'", message.account);
    forgetInflight(hot, message.account);
    throw error;
  }
  const receipt = await waitForReceipt(client, hash).catch((error: unknown) => {
    sql.exec("UPDATE actions SET tx_hash = ? WHERE proxy = ? AND tx_hash = 'inflight'", hash, message.account);
    hashInflight(hot, message.account, hash);
    throw error;
  });
  if (receipt.status !== "success") {
    sql.exec(
      "UPDATE actions SET status = 'reverted', tx_hash = ?, block = ? WHERE proxy = ? AND tx_hash = 'inflight'",
      hash,
      Number(receipt.blockNumber),
      message.account,
    );
    forgetInflight(hot, message.account);
    return Response.json({ error: "reverted", txHash: hash }, { status: 500 });
  }
  sql.exec(
    "UPDATE actions SET status = 'confirmed', tx_hash = ?, block = ? WHERE proxy = ? AND tx_hash = 'inflight'",
    hash,
    Number(receipt.blockNumber),
    message.account,
  );
  confirmInflight(hot, message.account, hash, Number(receipt.blockNumber));
  const after = await readAccountState(env, { proxy: message.account, account_id: pool.account_id, perp_id: pool.perp_id });
  const afterQuote = after ? evalQuote(after.position) : null;
  const liqAfter = afterQuote ? liquidationMicroFromContract(afterQuote.position, afterQuote.market) : liqBefore;
  const distAfter =
    after && afterQuote
      ? contractDistanceE6(afterQuote.position, afterQuote.market, after.position.markPNS)
      : decision.distBefore;
  if (after) {
    sql.exec("UPDATE actions SET dist_after = ? WHERE proxy = ? AND tx_hash = ?", distAfter.toString(), message.account, hash);
    noteDistanceHash(hot, hash);
    sql.exec("UPDATE mandates SET budget_used_cns = ? WHERE proxy = ?", decision.amountCNS.toString(), message.account);
    setBudget(hot, message.account, decision.amountCNS.toString());
  }
  return Response.json({
    txHash: hash,
    block: Number(receipt.blockNumber),
    addedCNS: decision.amountCNS.toString(),
    liqBefore: liqBefore.toString(),
    liqAfter: liqAfter.toString(),
    distBefore: decision.distBefore.toString(),
    distAfter: distAfter.toString(),
    msFromRequest: Date.now() - startedMs,
    reason,
  });
}

export async function disarmPosition(
  sql: Sql,
  env: LifelineEnv,
  claimant: Claimant,
  request: { proxy: string; nonce: string; signature: Hex },
  hot?: HotState | null,
): Promise<Response> {
  const proxy = getAddress(request.proxy);
  const signer = await recoverMessageAddress({ message: disarmMessage(proxy, request.nonce), signature: request.signature });
  if (getAddress(signer) !== claimant.address) return Response.json({ error: "forbidden" }, { status: 403 });
  if (nonceUsed(sql, proxy, BigInt(request.nonce))) return Response.json({ error: "nonce" }, { status: 409 });
  const urls = env.RPC_URLS_TESTNET.split(",").map((url) => url.trim()).filter((url) => url.length > 0);
  const client = openChain(TESTNET_ID, { urls, timeout: 8_000 }).client;
  const owner = await client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "owner" });
  if (getAddress(owner) !== signer) return Response.json({ error: "forbidden" }, { status: 403 });
  stampAccepted(sql, proxy, getAddress(owner), Date.now(), hot);
  const cached = hot?.loaded ? hot.mandates.find((item) => item.proxy === proxy) : undefined;
  const active = hot?.loaded
    ? cached?.active ?? null
    : Number(
        (sql.exec("SELECT active FROM mandates WHERE proxy = ?", proxy).toArray()[0] as { active?: number } | undefined)?.active,
      );
  if (hot?.loaded ? cached?.active !== 1 : !Number.isFinite(active) || active !== 1) {
    return Response.json({ error: "nonce" }, { status: 409 });
  }
  sql.exec("UPDATE mandates SET active = 0 WHERE proxy = ?", proxy);
  sql.exec("INSERT OR IGNORE INTO mandate_nonces (proxy, nonce) VALUES (?, ?)", proxy, request.nonce);
  if (cached) putMandate(hot, { ...cached, active: 0 });
  return Response.json({ proxy, active: false });
}
