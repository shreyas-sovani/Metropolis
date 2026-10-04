import type { Abi } from "viem";

/** Hand-written factory fragments. Factory Solidity is BUSL-1.1 and is not copied. */
export const delegatedAccountFactoryAbi = [
  {
    type: "function",
    name: "create",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_operator", type: "address" },
      { name: "_opDeadline", type: "uint256" },
      { name: "_opSig", type: "bytes" },
    ],
    outputs: [{ name: "proxy", type: "address" }],
  },
  {
    type: "function",
    name: "operatorNonces",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "event",
    name: "DelegatedAccountCreated",
    inputs: [
      { name: "proxy", type: "address", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "operator", type: "address", indexed: true },
    ],
  },
] as const satisfies Abi;
