import type { Address, TypedDataDomain } from "viem";

/** Factory EIP-712 domain: name `DelegatedAccountFactory`, version `1`. */
export function factoryDomain(factory: Address, chainId: number): TypedDataDomain {
  return {
    name: "DelegatedAccountFactory",
    version: "1",
    chainId,
    verifyingContract: factory,
  };
}

export const assignOperatorTypes = {
  AssignOperator: [
    { name: "owner", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
