import { hashTypedData, recoverTypedDataAddress, type Address, type Hex, type TypedDataDomain } from "viem";

/** PRD §F5 domain: name `Lifeline`, version `1`, Monad testnet. */
export function mandateDomain(chainId = 10143): TypedDataDomain {
  return { name: "Lifeline", version: "1", chainId };
}

export const mandateTypes = {
  Mandate: [
    { name: "account", type: "address" },
    { name: "perpIds", type: "uint256[]" },
    { name: "triggerBps", type: "uint16" },
    { name: "targetBps", type: "uint16" },
    { name: "maxPerActionCNS", type: "uint256" },
    { name: "budgetCNS", type: "uint256" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface MandateMessage {
  account: Address;
  perpIds: readonly bigint[];
  triggerBps: number;
  targetBps: number;
  maxPerActionCNS: bigint;
  budgetCNS: bigint;
  expiry: bigint;
  nonce: bigint;
}

export const MANDATE_MAX_TARGET_BPS = 2000;
export const MANDATE_MAX_EXPIRY_SEC = 30n * 24n * 60n * 60n;

export type MandateIssue = "trigger" | "target" | "cap" | "expiry" | "market" | "nonce";

export type MandateValidation = { ok: true } | { ok: false; reason: MandateIssue };

export interface MandateContext {
  nowSec: bigint;
  accountPerpIds: readonly bigint[];
  usedNonces: readonly bigint[];
}

export function buildMandate(input: MandateMessage): MandateMessage {
  return {
    account: input.account,
    perpIds: [...input.perpIds],
    triggerBps: input.triggerBps,
    targetBps: input.targetBps,
    maxPerActionCNS: input.maxPerActionCNS,
    budgetCNS: input.budgetCNS,
    expiry: input.expiry,
    nonce: input.nonce,
  };
}

export function hashMandate(message: MandateMessage, chainId = 10143): Hex {
  return hashTypedData({
    domain: mandateDomain(chainId),
    types: mandateTypes,
    primaryType: "Mandate",
    message,
  });
}

export function recoverSigner(message: MandateMessage, signature: Hex, chainId = 10143): Promise<Address> {
  return recoverTypedDataAddress({
    domain: mandateDomain(chainId),
    types: mandateTypes,
    primaryType: "Mandate",
    message,
    signature,
  });
}

export function validateMandate(message: MandateMessage, ctx: MandateContext): MandateValidation {
  if (message.triggerBps <= 0 || message.triggerBps >= message.targetBps) return { ok: false, reason: "trigger" };
  if (message.targetBps > MANDATE_MAX_TARGET_BPS) return { ok: false, reason: "target" };
  if (message.maxPerActionCNS <= 0n || message.budgetCNS <= 0n) return { ok: false, reason: "cap" };
  if (message.expiry <= ctx.nowSec || message.expiry > ctx.nowSec + MANDATE_MAX_EXPIRY_SEC) {
    return { ok: false, reason: "expiry" };
  }
  if (message.perpIds.length === 0) return { ok: false, reason: "market" };
  for (const perpId of message.perpIds) {
    if (!ctx.accountPerpIds.some((id) => id === perpId)) return { ok: false, reason: "market" };
  }
  if (ctx.usedNonces.some((nonce) => nonce === message.nonce)) return { ok: false, reason: "nonce" };
  return { ok: true };
}

/** Defaults from the user mandate in PRD §F5, for one market. */
export function mandateMessage(args: {
  account: Address;
  perpId: bigint;
  nonce?: bigint;
  expiry?: bigint;
}): MandateMessage {
  return {
    account: args.account,
    perpIds: [args.perpId],
    triggerBps: 400,
    targetBps: 600,
    maxPerActionCNS: 150_000_000n,
    budgetCNS: 50_000_000n,
    expiry: args.expiry ?? 1_800_000_000n,
    nonce: args.nonce ?? 0n,
  };
}
