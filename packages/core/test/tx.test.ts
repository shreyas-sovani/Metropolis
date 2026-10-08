import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { delegatedAccountAbi } from "../src/abi/delegatedAccount.js";
import { delegatedAccountFactoryAbi } from "../src/abi/delegatedAccountFactory.js";
import { erc20Abi } from "../src/abi/erc20.js";
import { exchangeAbi } from "../src/abi/exchange.js";
import { GAS_LIMITS } from "../src/config/gas.js";
import { ORDER_OPEN_LONG, orderDesc } from "../src/orders/index.js";
import {
  MON_DRIP_WEI,
  acceptOwnershipTx,
  ausdTransferTx,
  createAccountTx,
  factoryCreateTx,
  faucetRequestFundsTx,
  increasePositionCollateralTx,
  iocOpenTx,
  monDripTx,
  postOnlyMakerTx,
  revokeOperatorAllowlistTxs,
  transferOwnershipTx,
  withdrawCollateralTx,
} from "../src/tx/builders.js";

const PROXY = "0xEc73AFB31b20729160c247A3009C193a4842e95A" as const;
const TOKEN = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" as const;
const FACTORY = "0xf42548Ccb3300Bc76c35dc2D347416db2E8d7209" as const;
const FAUCET = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C" as const;
const OWNER = "0x00000000000000000000000000000000000000a1" as const;
const OPERATOR = "0x00000000000000000000000000000000000000a2" as const;

describe("transaction builders", () => {
  it("matches reference calldata and the measured gas limits", () => {
    const topUp = increasePositionCollateralTx(PROXY, 16n, 1_000_000n);
    expect(topUp).toEqual({
      to: PROXY,
      data: encodeFunctionData({
        abi: exchangeAbi,
        functionName: "increasePositionCollateral",
        args: [16n, 1_000_000n],
      }),
      gas: GAS_LIMITS.increasePositionCollateral,
      value: 0n,
    });
    expect(transferOwnershipTx(PROXY, OWNER).data).toBe(
      encodeFunctionData({ abi: delegatedAccountAbi, functionName: "transferOwnership", args: [OWNER] }),
    );
    expect(acceptOwnershipTx(PROXY).gas).toBe(GAS_LIMITS.acceptOwnership);
    expect(withdrawCollateralTx(PROXY, 1n).data).toBe(
      encodeFunctionData({ abi: delegatedAccountAbi, functionName: "withdrawCollateral", args: [1n] }),
    );
    expect(monDripTx(OWNER)).toEqual({
      to: OWNER,
      data: "0x",
      gas: GAS_LIMITS.monDrip,
      value: MON_DRIP_WEI,
    });
    const sig = `0x${"11".repeat(65)}` as const;
    expect(factoryCreateTx(FACTORY, OPERATOR, 10n, sig).data).toBe(
      encodeFunctionData({
        abi: delegatedAccountFactoryAbi,
        functionName: "create",
        args: [OPERATOR, 10n, sig],
      }),
    );
    expect(ausdTransferTx(TOKEN, PROXY, 400n).data).toBe(
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [PROXY, 400n] }),
    );
    expect(createAccountTx(PROXY, 400n).gas).toBe(GAS_LIMITS.createAccount);
    const revoked = revokeOperatorAllowlistTxs(PROXY);
    expect(revoked).toHaveLength(6);
    for (const call of revoked) expect(call.gas).toBe(GAS_LIMITS.setOperatorAllowlist);
    const order = orderDesc({
      perpId: 16n,
      orderType: ORDER_OPEN_LONG,
      pricePNS: 80_000n,
      lotLNS: 100n,
      leverageHdths: 1500n,
    });
    const ioc = iocOpenTx(PROXY, order);
    expect(ioc.gas).toBe(GAS_LIMITS.execOrderOpen);
    expect(ioc.data).toBe(
      encodeFunctionData({
        abi: exchangeAbi,
        functionName: "execOrder",
        args: [{ ...order, immediateOrCancel: true, postOnly: false }],
      }),
    );
    const maker = postOnlyMakerTx(TOKEN, order);
    expect(maker.data).toBe(
      encodeFunctionData({
        abi: exchangeAbi,
        functionName: "execOrder",
        args: [{ ...order, postOnly: true, immediateOrCancel: false }],
      }),
    );
    expect(faucetRequestFundsTx(FAUCET, OWNER).gas).toBe(GAS_LIMITS.faucetRequestFunds);
  });
});
