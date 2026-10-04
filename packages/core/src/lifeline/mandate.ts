import type { Address, TypedDataDomain } from "viem";

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
