import { describe, expect, it } from "vitest";
import { keccak256, recoverTypedDataAddress, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assignOperatorTypes,
  bookPricePNS,
  factoryDomain,
  leverageHdths,
  orderDesc,
  restingAskPricePNS,
  ORDER_OPEN_SHORT,
} from "../src/orders/index.js";

describe("orders", () => {
  it("hashes AssignOperator the way the factory typehash is defined", () => {
    const typehash = `0x${"0cc8ebd31b1a2ecbd13342f435303d16"}${"307b90e0f976c0f1d7194067f4d65fdf"}`;
    expect(keccak256(toBytes("AssignOperator(address owner,uint256 nonce,uint256 deadline)"))).toBe(
      typehash,
    );
  });

  it("recovers the operator from an AssignOperator signature", async () => {
    const operator = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const owner = privateKeyToAccount(`0x${"22".repeat(32)}`);
    const domain = factoryDomain("0x00000000000000000000000000000000000000a1", 10143);
    const message = { owner: owner.address, nonce: 0n, deadline: 1_800_000_000n };
    const signature = await operator.signTypedData({
      domain,
      types: assignOperatorTypes,
      primaryType: "AssignOperator",
      message,
    });
    const recovered = await recoverTypedDataAddress({
      domain,
      types: assignOperatorTypes,
      primaryType: "AssignOperator",
      message,
      signature,
    });
    expect(recovered).toBe(operator.address);
  });

  it("places a post-only ask inside the spread, 0.05% above the mark", () => {
    const price = restingAskPricePNS({
      markPNS: 854_188n,
      basePricePNS: 50_000n,
      maxBidPriceONS: 803_959n,
      minAskPriceONS: 804_659n,
    });
    const bestBid = bookPricePNS(50_000n, 803_959n);
    const bestAsk = bookPricePNS(50_000n, 804_659n);
    expect(price).toBe((854_188n * 10_005n) / 10_000n);
    expect(price > bestBid).toBe(true);
    expect(price < bestAsk).toBe(true);
  });

  it("computes 15× when deposit is notional divided by 15", () => {
    const pricePNS = 100_000n;
    const lotLNS = 1_000n;
    const depositCNS = (pricePNS * lotLNS * 1_000_000n) / (10n * 100n * 15n);
    expect(
      leverageHdths({
        pricePNS,
        priceDecimals: 1,
        lotLNS,
        lotDecimals: 2,
        depositCNS,
      }),
    ).toBe(1500n);
  });

  it("builds an open-short descriptor", () => {
    const desc = orderDesc({
      perpId: 16n,
      orderType: ORDER_OPEN_SHORT,
      pricePNS: 1n,
      lotLNS: 100n,
      leverageHdths: 1500n,
      postOnly: true,
    });
    expect(desc.orderType).toBe(ORDER_OPEN_SHORT);
    expect(desc.postOnly).toBe(true);
    expect(desc.maxMatches).toBe(0n);
    expect(desc.maxNegPnlCollatBPS).toBe(1000n);
  });
});