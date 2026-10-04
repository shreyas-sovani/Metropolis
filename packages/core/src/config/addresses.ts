import type { Address } from "viem";
import { MAINNET_ID, TESTNET_ID, type ChainId } from "./chains.js";

export interface ChainAddresses {
  exchange: Address;
  ausd: Address;
  multicall3: Address;
  factory: Address | null;
  faucet: Address | null;
}

/** PRD §5.2. Mainnet factory and faucet are unused in the core. */
export const ADDRESSES: Record<ChainId, ChainAddresses> = {
  [MAINNET_ID]: {
    exchange: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
    ausd: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    factory: null,
    faucet: null,
  },
  [TESTNET_ID]: {
    exchange: "0x1964C32f0bE608E7D29302AFF5E61268E72080cc",
    factory: "0xf42548Ccb3300Bc76c35dc2D347416db2E8d7209",
    ausd: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
    faucet: "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  },
};
