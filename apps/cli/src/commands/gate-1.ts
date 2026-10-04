import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ADDRESSES,
  ORDER_OPEN_LONG,
  TESTNET_ID,
  delegatedAccountAbi,
  erc20Abi,
  exchangeAbi,
  orderDesc,
} from "@lifeline/core";
import { encodeFunctionData, toFunctionSelector, type Address, type Hex } from "viem";
import { loadRoles } from "../roles.js";
import { sendContract } from "../send.js";
import { testnetPublicClient, testnetWallet } from "../testnet.js";
import { workspaceRoot } from "./keys-generate.js";

const PERP_BTC = 16n;
const ONE_AUSD = 1_000_000n;

const REVOKED = [
  "execOrder",
  "execOrders",
  "requestDecreasePositionCollateral",
  "buyLiquidations",
  "depositCollateral",
  "allowOrderForwarding",
] as const;

function selectorOf(name: string): Hex {
  const item = exchangeAbi.find((entry) => entry.type === "function" && entry.name === name);
  if (!item || item.type !== "function") throw new Error(`missing ${name}`);
  return toFunctionSelector(item);
}

function proxyOf(root: string): Address {
  const file = path.join(root, "cli-state", "gate-6.json");
  const state = JSON.parse(readFileSync(file, "utf8")) as { proxy?: Address };
  if (!state.proxy) throw new Error("gate-6 proxy missing");
  return state.proxy;
}

export async function gate1(root = workspaceRoot()): Promise<number> {
  const roles = loadRoles(root);
  const client = testnetPublicClient();
  const proxy = proxyOf(root);
  const exchange = ADDRESSES[TESTNET_ID].exchange;
  const ausd = ADDRESSES[TESTNET_ID].ausd;
  if (!ausd) throw new Error("testnet AUSD missing");
  const owner = roles.POOL_OWNER;
  const operator = roles.OPERATOR;
  const ownerWallet = testnetWallet(owner);
  const operatorWallet = testnetWallet(operator);

  const accountId = (await client.readContract({
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "accountId",
  })) as bigint;
  const before = await readMargins(client, exchange, proxy, accountId);

  for (const name of REVOKED) {
    const selector = selectorOf(name);
    await sendContract({
      client,
      wallet: ownerWallet,
      account: owner,
      address: proxy,
      abi: delegatedAccountAbi,
      functionName: "setOperatorAllowlist",
      args: [selector, false],
      kind: `allowlist.${name}`,
    });
    const allowed = (await client.readContract({
      address: proxy,
      abi: delegatedAccountAbi,
      functionName: "operatorAllowlist",
      args: [selector],
    })) as boolean;
    console.log(`allowlist.${name} ${selector} allowed=${allowed}`);
    if (allowed) return 1;
  }

  const topUp = await sendContract({
    client,
    wallet: operatorWallet,
    account: operator,
    address: proxy,
    abi: exchangeAbi,
    functionName: "increasePositionCollateral",
    args: [PERP_BTC, ONE_AUSD],
    kind: "operator.increasePositionCollateral",
  });

  const after = await readMargins(client, exchange, proxy, accountId);
  const depositDelta = after.depositCNS - before.depositCNS;
  const freeDelta = after.freeCNS - before.freeCNS;
  console.log(
    `topup tx ${topUp.hash} deposit ${before.depositCNS}->${after.depositCNS} delta=${depositDelta} free ${before.freeCNS}->${after.freeCNS} delta=${freeDelta}`,
  );
  if (depositDelta !== ONE_AUSD || freeDelta !== -ONE_AUSD) return 1;

  const calls: { name: string; data: Hex }[] = [
    {
      name: "execOrder",
      data: encodeFunctionData({
        abi: exchangeAbi,
        functionName: "execOrder",
        args: [
          orderDesc({
            perpId: PERP_BTC,
            orderType: ORDER_OPEN_LONG,
            pricePNS: 1n,
            lotLNS: 1n,
            leverageHdths: 1500n,
          }),
        ],
      }),
    },
    {
      name: "execOrders",
      data: encodeFunctionData({
        abi: exchangeAbi,
        functionName: "execOrders",
        args: [
          [
            orderDesc({
              perpId: PERP_BTC,
              orderType: ORDER_OPEN_LONG,
              pricePNS: 1n,
              lotLNS: 1n,
              leverageHdths: 1500n,
            }),
          ],
          false,
        ],
      }),
    },
    {
      name: "requestDecreasePositionCollateral",
      data: encodeFunctionData({
        abi: exchangeAbi,
        functionName: "requestDecreasePositionCollateral",
        args: [PERP_BTC, ONE_AUSD, false],
      }),
    },
    {
      name: "buyLiquidations",
      data: encodeFunctionData({
        abi: exchangeAbi,
        functionName: "buyLiquidations",
        args: [[], false],
      }),
    },
    {
      name: "depositCollateral",
      data: encodeFunctionData({
        abi: exchangeAbi,
        functionName: "depositCollateral",
        args: [ONE_AUSD],
      }),
    },
    {
      name: "allowOrderForwarding",
      data: encodeFunctionData({
        abi: exchangeAbi,
        functionName: "allowOrderForwarding",
        args: [false],
      }),
    },
    {
      name: "withdrawCollateral",
      data: encodeFunctionData({
        abi: delegatedAccountAbi,
        functionName: "withdrawCollateral",
        args: [ONE_AUSD],
      }),
    },
    {
      name: "erc20.transfer",
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [operator.address, 1n],
      }),
    },
  ];

  let revertedCount = 0;
  for (const call of calls) {
    try {
      await client.call({
        account: operator.address,
        to: proxy,
        data: call.data,
      });
      console.log(`${call.name} did not revert`);
    } catch (error) {
      const message = error instanceof Error ? (error.message.split("\n")[0] ?? "reverted") : "reverted";
      console.log(`${call.name} reverted ${message.slice(0, 140)}`);
      revertedCount += 1;
    }
  }
  if (revertedCount !== calls.length) return 1;

  const withdrawn = await sendContract({
    client,
    wallet: ownerWallet,
    account: owner,
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "withdrawCollateral",
    args: [ONE_AUSD],
    kind: "owner.withdrawCollateral",
  });
  console.log(`owner.withdrawCollateral tx ${withdrawn.hash} status=${withdrawn.status} gas=${withdrawn.gasUsed}`);
  console.log(`simulated=${revertedCount} revoked=${REVOKED.length}`);
  return withdrawn.status === 1 ? 0 : 1;
}

async function readMargins(
  client: ReturnType<typeof testnetPublicClient>,
  exchange: Address,
  proxy: Address,
  accountId: bigint,
) {
  const account = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getAccountById",
    args: [accountId],
  })) as { balanceCNS: bigint; lockedBalanceCNS: bigint };
  const position = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPositionV2",
    args: [PERP_BTC, accountId],
  })) as readonly [{ depositCNS: bigint }, bigint, boolean];
  void proxy;
  return {
    depositCNS: position[0].depositCNS,
    freeCNS: account.balanceCNS - account.lockedBalanceCNS,
    balanceCNS: account.balanceCNS,
    lockedCNS: account.lockedBalanceCNS,
  };
}
