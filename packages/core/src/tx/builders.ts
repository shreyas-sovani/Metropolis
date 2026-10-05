import {
  encodeFunctionData,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { delegatedAccountAbi } from "../abi/delegatedAccount.js";
import { delegatedAccountFactoryAbi } from "../abi/delegatedAccountFactory.js";
import { erc20Abi } from "../abi/erc20.js";
import { exchangeAbi } from "../abi/exchange.js";
import { faucetAbi } from "../abi/faucet.js";
import { GAS_LIMITS } from "../config/gas.js";
import { type OrderDesc } from "../orders/desc.js";

/** 0.08 testnet MON, the claim drip from PRD §F4. */
export const MON_DRIP_WEI = 8n * 10n ** 16n;

export interface TxRequest {
  to: Address;
  data: Hex;
  gas: bigint;
  value: bigint;
}

const REVOKED = [
  "execOrder",
  "execOrders",
  "requestDecreasePositionCollateral",
  "buyLiquidations",
  "depositCollateral",
  "allowOrderForwarding",
] as const;

function limit(name: string): bigint {
  const value = GAS_LIMITS[name];
  if (value === undefined) throw new Error(`missing gas limit ${name}`);
  return value;
}

function tx(to: Address, data: Hex, gas: bigint, value = 0n): TxRequest {
  return { to, data, gas, value };
}

export function functionSelector(name: string): Hex {
  const item = exchangeAbi.find((entry) => entry.type === "function" && entry.name === name);
  if (!item || item.type !== "function") throw new Error(`missing ${name}`);
  return toFunctionSelector(item);
}

export function increasePositionCollateralTx(proxy: Address, perpId: bigint, amountCNS: bigint): TxRequest {
  return tx(
    proxy,
    encodeFunctionData({
      abi: exchangeAbi,
      functionName: "increasePositionCollateral",
      args: [perpId, amountCNS],
    }),
    limit("increasePositionCollateral"),
  );
}

export function transferOwnershipTx(proxy: Address, newOwner: Address): TxRequest {
  return tx(
    proxy,
    encodeFunctionData({
      abi: delegatedAccountAbi,
      functionName: "transferOwnership",
      args: [newOwner],
    }),
    limit("transferOwnership"),
  );
}

export function acceptOwnershipTx(proxy: Address): TxRequest {
  return tx(
    proxy,
    encodeFunctionData({ abi: delegatedAccountAbi, functionName: "acceptOwnership", args: [] }),
    limit("acceptOwnership"),
  );
}

export function withdrawCollateralTx(proxy: Address, amountCNS: bigint): TxRequest {
  return tx(
    proxy,
    encodeFunctionData({
      abi: delegatedAccountAbi,
      functionName: "withdrawCollateral",
      args: [amountCNS],
    }),
    limit("withdrawCollateral"),
  );
}

export function monDripTx(to: Address, value = MON_DRIP_WEI): TxRequest {
  return tx(to, "0x", limit("monDrip"), value);
}

export function factoryCreateTx(
  factory: Address,
  operator: Address,
  deadline: bigint,
  signature: Hex,
): TxRequest {
  return tx(
    factory,
    encodeFunctionData({
      abi: delegatedAccountFactoryAbi,
      functionName: "create",
      args: [operator, deadline, signature],
    }),
    limit("factoryCreate"),
  );
}

export function ausdTransferTx(token: Address, to: Address, amount: bigint): TxRequest {
  return tx(
    token,
    encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
    limit("ausdTransfer"),
  );
}

export function createAccountTx(account: Address, amountCNS: bigint): TxRequest {
  return tx(
    account,
    encodeFunctionData({
      abi: delegatedAccountAbi,
      functionName: "createAccount",
      args: [amountCNS],
    }),
    limit("createAccount"),
  );
}

export function setOperatorAllowlistTx(proxy: Address, selector: Hex, allowed: boolean): TxRequest {
  return tx(
    proxy,
    encodeFunctionData({
      abi: delegatedAccountAbi,
      functionName: "setOperatorAllowlist",
      args: [selector, allowed],
    }),
    limit("setOperatorAllowlist"),
  );
}

/** The six selectors revoked at provisioning. Each transaction uses the measured gas limit. */
export function revokeOperatorAllowlistTxs(proxy: Address): TxRequest[] {
  return REVOKED.map((name) => setOperatorAllowlistTx(proxy, functionSelector(name), false));
}

export function execOrderTx(to: Address, order: OrderDesc): TxRequest {
  return tx(
    to,
    encodeFunctionData({ abi: exchangeAbi, functionName: "execOrder", args: [order] }),
    limit("execOrderOpen"),
  );
}

export function iocOpenTx(proxy: Address, order: OrderDesc): TxRequest {
  return execOrderTx(proxy, { ...order, immediateOrCancel: true, postOnly: false });
}

export function postOnlyMakerTx(exchange: Address, order: OrderDesc): TxRequest {
  return execOrderTx(exchange, { ...order, postOnly: true, immediateOrCancel: false });
}

export function faucetRequestFundsTx(faucet: Address, receiver: Address): TxRequest {
  return tx(
    faucet,
    encodeFunctionData({ abi: faucetAbi, functionName: "requestFunds", args: [receiver] }),
    limit("faucetRequestFunds"),
  );
}
