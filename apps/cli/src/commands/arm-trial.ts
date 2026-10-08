import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ADDRESSES,
  TESTNET_ID,
  acceptOwnershipTx,
  buildMandate,
  contractDistanceE6,
  delegatedAccountAbi,
  exchangeAbi,
  mandateDomain,
  mandateTypes,
  readAccountByAddr,
  readPositionsForAccount,
} from "@lifeline/core";
import { getAddress, type Address, type PublicClient } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { loadRoles } from "../roles.js";
import { testnetPublicClient, testnetWallet } from "../testnet.js";
import { DEFAULT_WORKER_URL } from "./pool-register.js";
import { workspaceRoot } from "./keys-generate.js";

const TRIGGER_BPS = 400;
const TARGET_BPS = 600;
const CAP_CNS = 150_000_000n;
/** W5: distance after a top-up is inside [target − 0.2%, target + 0.5%]. */
const BAND_LOW_E6 = 2_000n;
const BAND_HIGH_E6 = 5_000n;

interface PoolFile {
  accounts?: { proxy?: string; perpId?: string }[];
}

interface ArmBody {
  txHash?: string;
  distBefore?: string;
  distAfter?: string;
  msFromRequest?: number;
  addedCNS?: string;
  reason?: string;
  skipped?: boolean;
  error?: string;
}

export function distanceInTargetBand(distAfterE6: bigint, targetBps = TARGET_BPS): boolean {
  const target = (BigInt(targetBps) * 1_000_000n) / 10_000n;
  return distAfterE6 >= target - BAND_LOW_E6 && distAfterE6 <= target + BAND_HIGH_E6;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function adminSecret(root: string): string {
  const file = path.join(root, "secrets", "services.env");
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.startsWith("ADMIN_SECRET=")) continue;
    return line.slice("ADMIN_SECRET=".length).trim();
  }
  return "";
}

function proofMessage(userId: string, address: string, nonce: string): string {
  return `lifeline:${userId}:${address}:${nonce}`;
}

function disarmText(proxy: Address, nonce: string): string {
  return `lifeline-disarm:${getAddress(proxy)}:${nonce}`;
}

export async function headersFor(
  account: PrivateKeyAccount,
  secret: string,
  userId: string,
  nonce: string,
  ip?: string,
): Promise<Record<string, string>> {
  const signature = await account.signMessage({ message: proofMessage(userId, account.address, nonce) });
  return {
    "content-type": "application/json",
    "x-admin-secret": secret,
    "x-lifeline-user": userId,
    "x-lifeline-address": account.address,
    "x-lifeline-signature": signature,
    "x-lifeline-nonce": nonce,
    ...(ip ? { "x-lifeline-ip": ip } : {}),
  };
}

async function marketOf(client: PublicClient, perpId: bigint) {
  const exchange = ADDRESSES[TESTNET_ID].exchange;
  const packed = await client.multicall({
    contracts: [
      { address: exchange, abi: exchangeAbi, functionName: "getPerpetualInfoV2", args: [perpId] },
      { address: exchange, abi: exchangeAbi, functionName: "getMarginFractions", args: [perpId, 0n] },
    ],
    allowFailure: false,
  });
  const info = packed[0] as { priceDecimals: bigint; lotDecimals: bigint };
  return {
    priceDecimals: Number(info.priceDecimals),
    lotDecimals: Number(info.lotDecimals),
    maintHdths: maintHdths(packed[1]),
  };
}

function maintHdths(value: unknown): bigint {
  if (Array.isArray(value) && typeof value[1] === "bigint") return value[1];
  if (value && typeof value === "object" && "perpMaintMarginFracHdths" in value) {
    const hdths = value.perpMaintMarginFracHdths;
    if (typeof hdths === "bigint") return hdths;
  }
  throw new Error("margin fractions missing");
}

export async function distanceE6Of(client: PublicClient, proxy: Address, perpId: bigint): Promise<bigint> {
  const exchange = ADDRESSES[TESTNET_ID].exchange;
  const account = await readAccountByAddr(client, exchange, proxy);
  const positions = await readPositionsForAccount(client, exchange, account.accountId);
  const position = positions.find((item) => BigInt(item.perpId) === perpId);
  if (!position) throw new Error(`${proxy} has no position`);
  const market = await marketOf(client, perpId);
  return contractDistanceE6(
    {
      positionType: position.position.positionType,
      pricePNS: position.position.pricePNS,
      lotLNS: position.position.lotLNS,
      depositCNS: position.position.depositCNS,
      premiumPnlCNS: position.position.premiumPnlCNS,
    },
    market,
    position.markPricePNS,
  );
}

async function acceptIfPending(client: PublicClient, proxy: Address, owner: PrivateKeyAccount): Promise<void> {
  const pending = getAddress(
    await client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "pendingOwner" }),
  );
  if (pending === "0x0000000000000000000000000000000000000000") return;
  if (pending !== owner.address) throw new Error(`${proxy} pending owner is ${pending}`);
  const wallet = testnetWallet(owner);
  const built = acceptOwnershipTx(proxy);
  const nonce = await client.getTransactionCount({ address: owner.address, blockTag: "pending" });
  const hash = await wallet.sendTransaction({
    account: owner,
    chain: wallet.chain,
    to: built.to,
    data: built.data,
    gas: built.gas,
    nonce,
    value: 0n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 200 });
  if (receipt.status !== "success") throw new Error(`${proxy} accept ${hash} failed`);
  console.log(`accept ${proxy} ${hash}`);
}

export async function armTrial(root = workspaceRoot(), argv: readonly string[] = []): Promise<number> {
  const secret = adminSecret(root);
  if (!secret) {
    console.error("ADMIN_SECRET missing");
    return 1;
  }
  const urlFlag = argv.indexOf("--url");
  const base = (urlFlag >= 0 ? argv[urlFlag + 1] ?? DEFAULT_WORKER_URL : DEFAULT_WORKER_URL).replace(/\/$/, "");
  const roles = loadRoles(root);
  const owner = roles.TEST_OWNER;
  const pool = JSON.parse(readFileSync(path.join(root, "cli-state", "pool.json"), "utf8")) as PoolFile;
  const client = testnetPublicClient();
  const owned: { proxy: Address; perpId: bigint; dist: bigint }[] = [];
  for (const account of pool.accounts ?? []) {
    if (!account.proxy || !account.perpId) continue;
    const proxy = getAddress(account.proxy);
    const onchain = getAddress(
      await client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "owner" }),
    );
    const pending = getAddress(
      await client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "pendingOwner" }),
    );
    if (onchain !== owner.address && pending !== owner.address) continue;
    if (onchain !== owner.address) await acceptIfPending(client, proxy, owner);
    const perpId = BigInt(account.perpId);
    const dist = await distanceE6Of(client, proxy, perpId);
    console.log(`owned ${proxy} dist=${dist}`);
    if (dist < 40_000n) owned.push({ proxy, perpId, dist });
  }
  if (owned.length < 5) {
    console.error(`need 5 positions under 4%, have ${owned.length}`);
    return 1;
  }
  const trials = owned.slice(0, 5);
  const near = trials.some((item) => item.dist >= 24_000n && item.dist <= 32_000n);
  if (!near) {
    console.error("no owned position near 2.7%");
    return 1;
  }

  const lead = trials[0];
  if (!lead) return 1;
  const stranger = roles.MAKER;
  const forbiddenMandate = buildMandate({
    account: lead.proxy,
    perpIds: [lead.perpId],
    triggerBps: TRIGGER_BPS,
    targetBps: TARGET_BPS,
    maxPerActionCNS: CAP_CNS,
    budgetCNS: CAP_CNS,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60),
    nonce: 99n,
  });
  const forbiddenSig = await stranger.signTypedData({
    domain: mandateDomain(),
    types: mandateTypes,
    primaryType: "Mandate",
    message: forbiddenMandate,
  });
  const forbidden = await fetch(`${base}/arm`, {
    method: "POST",
    headers: await headersFor(stranger, secret, "did:privy:w7-stranger", "w7-stranger"),
    body: JSON.stringify({
      mandate: jsonMandate(forbiddenMandate),
      signature: forbiddenSig,
    }),
  });
  if (forbidden.status !== 403) {
    console.error(`non-owner status ${forbidden.status} ${await forbidden.text()}`);
    return 1;
  }
  console.log("non-owner 403");

  const samples: number[] = [];
  let first: { proxy: Address; nonce: string; body: ArmBody } | null = null;
  for (const [index, trial] of trials.entries()) {
    const nonce = `${index + 1}`;
    const message = buildMandate({
      account: trial.proxy,
      perpIds: [trial.perpId],
      triggerBps: TRIGGER_BPS,
      targetBps: TARGET_BPS,
      maxPerActionCNS: CAP_CNS,
      budgetCNS: CAP_CNS,
      expiry: BigInt(Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60),
      nonce: BigInt(nonce),
    });
    const signature = await owner.signTypedData({
      domain: mandateDomain(),
      types: mandateTypes,
      primaryType: "Mandate",
      message,
    });
    const response = await fetch(`${base}/arm`, {
      method: "POST",
      headers: await headersFor(owner, secret, `did:privy:w7-arm-${index}`, `w7-arm-${index}`),
      body: JSON.stringify({ mandate: jsonMandate(message), signature }),
    });
    const body = (await response.json()) as ArmBody;
    if (!response.ok || !body.txHash || body.msFromRequest === undefined) {
      console.error(`arm ${trial.proxy} ${response.status} ${JSON.stringify(body)}`);
      return 1;
    }
    const after = await distanceE6Of(client, trial.proxy, trial.perpId);
    const band = distanceInTargetBand(after) || body.reason === "capped";
    console.log(
      `arm ${trial.proxy} tx=${body.txHash} ms=${body.msFromRequest} added=${body.addedCNS} chainDist=${after} reason=${body.reason ?? ""}`,
    );
    if (!band) {
      console.error(`${trial.proxy} distance ${after} outside the W5 band`);
      return 1;
    }
    samples.push(body.msFromRequest);
    if (!first) first = { proxy: trial.proxy, nonce, body };
  }
  const p50 = median(samples);
  console.log(`msFromRequest p50=${p50} samples=${samples.join(",")}`);
  if (p50 > 2_500) {
    console.error("p50 above 2500");
    return 1;
  }
  if (!first?.body.txHash) return 1;

  const replayMessage = buildMandate({
    account: first.proxy,
    perpIds: [lead.perpId],
    triggerBps: TRIGGER_BPS,
    targetBps: TARGET_BPS,
    maxPerActionCNS: CAP_CNS,
    budgetCNS: CAP_CNS,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60),
    nonce: BigInt(first.nonce),
  });
  const replaySig = await owner.signTypedData({
    domain: mandateDomain(),
    types: mandateTypes,
    primaryType: "Mandate",
    message: replayMessage,
  });
  const replay = await fetch(`${base}/arm`, {
    method: "POST",
    headers: await headersFor(owner, secret, "did:privy:w7-replay", "w7-replay"),
    body: JSON.stringify({ mandate: jsonMandate(replayMessage), signature: replaySig }),
  });
  if (replay.status !== 409) {
    console.error(`replay status ${replay.status} ${await replay.text()}`);
    return 1;
  }
  console.log("replay 409");

  const disarmNonce = "77";
  const disarmSig = await owner.signMessage({ message: disarmText(first.proxy, disarmNonce) });
  const disarmed = await fetch(`${base}/disarm`, {
    method: "POST",
    headers: await headersFor(owner, secret, "did:privy:w7-disarm", "w7-disarm"),
    body: JSON.stringify({ proxy: first.proxy, nonce: disarmNonce, signature: disarmSig }),
  });
  const disarmBody = (await disarmed.json()) as { active?: boolean; error?: string };
  if (!disarmed.ok || disarmBody.active !== false) {
    console.error(`disarm ${disarmed.status} ${JSON.stringify(disarmBody)}`);
    return 1;
  }
  console.log(`disarm ${first.proxy}`);

  const before = await recentHashes(base, secret, first.proxy);
  const breach = await fetch(`${base}/admin/breach`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-secret": secret },
    body: JSON.stringify({ proxy: first.proxy }),
  });
  const breachBody = (await breach.json()) as { armed?: boolean; error?: string };
  if (!breach.ok || breachBody.armed !== false) {
    console.error(`breach ${breach.status} ${JSON.stringify(breachBody)}`);
    return 1;
  }
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  const afterHashes = await recentHashes(base, secret, first.proxy);
  const fresh = afterHashes.filter((hash) => !before.includes(hash));
  if (fresh.length > 0) {
    console.error(`disarmed breach sent ${fresh.join(",")}`);
    return 1;
  }
  console.log(`disarm holds; breach armed=false; no new action on ${first.proxy}`);
  return 0;
}

export function jsonMandate(message: ReturnType<typeof buildMandate>) {
  return {
    account: message.account,
    perpIds: message.perpIds.map((id) => id.toString()),
    triggerBps: message.triggerBps,
    targetBps: message.targetBps,
    maxPerActionCNS: message.maxPerActionCNS.toString(),
    budgetCNS: message.budgetCNS.toString(),
    expiry: message.expiry.toString(),
    nonce: message.nonce.toString(),
  };
}

async function recentHashes(base: string, secret: string, proxy: Address): Promise<string[]> {
  const response = await fetch(`${base}/admin/soak`, { headers: { "x-admin-secret": secret } });
  const body = (await response.json()) as { recent?: { proxy?: string; tx_hash?: string }[]; error?: string };
  if (!response.ok) throw new Error(body.error ?? "soak");
  return (body.recent ?? [])
    .filter((row) => row.proxy && getAddress(row.proxy) === proxy && row.tx_hash)
    .map((row) => row.tx_hash as string);
}
