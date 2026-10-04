import { describe, expect, it } from "vitest";
import { exchangeAbi } from "../src/abi/exchange.js";
import { ADDRESSES, GAS_LIMITS, PUBLIC_RPC_URLS } from "../src/config/index.js";

describe("config", () => {
  it("sets G7 gas limits from measured testnet usage", () => {
    expect(Object.keys(GAS_LIMITS).sort()).toEqual([
      "acceptOwnership",
      "ausdTransfer",
      "createAccount",
      "execOrderOpen",
      "factoryCreate",
      "faucetRequestFunds",
      "increasePositionCollateral",
      "monDrip",
      "setOperatorAllowlist",
      "transferOwnership",
      "withdrawCollateral",
    ]);
    expect(GAS_LIMITS.factoryCreate).toBe(1_074_611n);
    expect(GAS_LIMITS.monDrip).toBe(36_000n);
  });

  it("lists PRD §5.2 addresses", () => {
    expect(ADDRESSES[143].exchange).toBe(
      "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
    );
    expect(ADDRESSES[143].ausd).toBe(
      "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
    );
    expect(ADDRESSES[143].factory).toBeNull();
    expect(ADDRESSES[143].faucet).toBeNull();
    expect(ADDRESSES[10143].factory).toBe(
      "0xf42548Ccb3300Bc76c35dc2D347416db2E8d7209",
    );
    expect(ADDRESSES[10143].faucet).toBe(
      "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C",
    );
    expect(ADDRESSES[143].multicall3).toBe(ADDRESSES[10143].multicall3);
  });

  it("orders public RPCs as public, then infra, then Alchemy on mainnet", () => {
    expect(PUBLIC_RPC_URLS[143]).toEqual([
      "https://rpc.monad.xyz",
      "https://rpc-mainnet.monadinfra.com",
      "https://rpc1.monad.xyz",
    ]);
    expect(PUBLIC_RPC_URLS[10143][0]).toBe("https://testnet-rpc.monad.xyz");
  });

  it("vendors getExchangeInfo", () => {
    expect(exchangeAbi.some((item) => item.type === "function" && item.name === "getExchangeInfo")).toBe(
      true,
    );
  });
});
