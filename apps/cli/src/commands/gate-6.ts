import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ADDRESSES,
  ORDER_CANCEL,
  ORDER_CLOSE_LONG,
  ORDER_CLOSE_SHORT,
  ORDER_OPEN_LONG,
  ORDER_OPEN_SHORT,
  TESTNET_ID,
  assignOperatorTypes,
  bookPricePNS,
  delegatedAccountAbi,
  delegatedAccountFactoryAbi,
  erc20Abi,
  exchangeAbi,
  factoryDomain,
  leverageHdths,
  orderDesc,
  restingAskPricePNS,
} from "@lifeline/core";
import {
  ContractFunctionRevertedError,
  decodeEventLog,
  type Address,
  type PublicClient,
} from "viem";
import { loadRoles } from "../roles.js";
import { sendContract } from "../send.js";
import { testnetPublicClient, testnetWallet } from "../testnet.js";
import { workspaceRoot } from "./keys-generate.js";

const PERP_BTC = 16n;
const TARGET_LEVERAGE_HDTHS = 1500n;
const REQUEST_LOT = 100n;
const POOL_AUSD = 400n * 1_000_000n;
const MAKER_AUSD = 1_000n * 1_000_000n;

interface Gate6State {
  proxy?: Address;
  liquidity?: string;
  selfMatch?: string;
}

function statePath(root: string) {
  return path.join(root, "cli-state", "gate-6.json");
}

function loadState(root: string): Gate6State {
  try {
    return JSON.parse(readFileSync(statePath(root), "utf8")) as Gate6State;
  } catch {
    return {};
  }
}

function saveState(root: string, state: Gate6State) {
  const file = statePath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

async function accountIdOf(
  client: PublicClient,
  exchange: Address,
  account: Address,
): Promise<bigint | null> {
  try {
    const info = (await client.readContract({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getAccountByAddr",
      args: [account],
    })) as { accountId: bigint };
    return info.accountId;
  } catch (error) {
    if (error instanceof ContractFunctionRevertedError) return null;
    const message = error instanceof Error ? error.message : "";
    if (message.includes("reverted")) return null;
    throw error;
  }
}

async function positionOf(client: PublicClient, exchange: Address, accountId: bigint) {
  const result = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPositionV2",
    args: [PERP_BTC, accountId],
  })) as readonly [
    {
      positionType: number;
      lotLNS: bigint;
      depositCNS: bigint;
      pricePNS: bigint;
    },
    bigint,
    boolean,
  ];
  return result[0];
}

function proxyFromReceipt(receipt: { logs: readonly { data: `0x${string}`; topics: readonly `0x${string}`[] }[] }): Address {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: delegatedAccountFactoryAbi,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      if (decoded.eventName === "DelegatedAccountCreated") {
        return decoded.args.proxy;
      }
    } catch {
      continue;
    }
  }
  throw new Error("DelegatedAccountCreated missing from factory receipt");
}

export async function gate6(root = workspaceRoot()): Promise<number> {
  const roles = loadRoles(root);
  const client = testnetPublicClient();
  const addresses = ADDRESSES[TESTNET_ID];
  const exchange = addresses.exchange;
  const factory = addresses.factory;
  const ausd = addresses.ausd;
  if (!factory || !ausd) throw new Error("testnet factory or AUSD missing");

  const owner = roles.POOL_OWNER;
  const operator = roles.OPERATOR;
  const maker = roles.MAKER;
  const ownerWallet = testnetWallet(owner);
  const makerWallet = testnetWallet(maker);
  const state = loadState(root);

  if (!state.proxy) {
    const nonce = (await client.readContract({
      address: factory,
      abi: delegatedAccountFactoryAbi,
      functionName: "operatorNonces",
      args: [operator.address],
    })) as bigint;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const signature = await operator.signTypedData({
      domain: factoryDomain(factory, TESTNET_ID),
      types: assignOperatorTypes,
      primaryType: "AssignOperator",
      message: { owner: owner.address, nonce, deadline },
    });
    const created = await sendContract({
      client,
      wallet: ownerWallet,
      account: owner,
      address: factory,
      abi: delegatedAccountFactoryAbi,
      functionName: "create",
      args: [operator.address, deadline, signature],
      kind: "factory.create",
    });
    state.proxy = proxyFromReceipt(created.receipt);
    saveState(root, state);
  }
  const proxy = state.proxy;
  if (!proxy) return 1;
  console.log(`proxy ${proxy}`);

  let proxyAccount = (await client.readContract({
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "accountId",
  })) as bigint;
  if (proxyAccount === 0n) {
    const balance = (await client.readContract({
      address: ausd,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [proxy],
    })) as bigint;
    if (balance < POOL_AUSD) {
      await sendContract({
        client,
        wallet: ownerWallet,
        account: owner,
        address: ausd,
        abi: erc20Abi,
        functionName: "transfer",
        args: [proxy, POOL_AUSD],
        kind: "ausd.transfer",
      });
    }
    await sendContract({
      client,
      wallet: ownerWallet,
      account: owner,
      address: proxy,
      abi: delegatedAccountAbi,
      functionName: "createAccount",
      args: [POOL_AUSD],
      kind: "proxy.createAccount",
    });
    proxyAccount = (await client.readContract({
      address: proxy,
      abi: delegatedAccountAbi,
      functionName: "accountId",
    })) as bigint;
  }
  console.log(`proxyAccount ${proxyAccount}`);
  if (proxyAccount === 0n) return 1;

  let makerAccount = await accountIdOf(client, exchange, maker.address);
  if (makerAccount === null) {
    const allowance = (await client.readContract({
      address: ausd,
      abi: erc20Abi,
      functionName: "allowance",
      args: [maker.address, exchange],
    })) as bigint;
    if (allowance < MAKER_AUSD) {
      await sendContract({
        client,
        wallet: makerWallet,
        account: maker,
        address: ausd,
        abi: erc20Abi,
        functionName: "approve",
        args: [exchange, MAKER_AUSD],
        kind: "ausd.approve",
      });
    }
    await sendContract({
      client,
      wallet: makerWallet,
      account: maker,
      address: exchange,
      abi: exchangeAbi,
      functionName: "createAccount",
      args: [MAKER_AUSD],
      kind: "maker.createAccount",
    });
    makerAccount = await accountIdOf(client, exchange, maker.address);
  }
  console.log(`makerAccount ${makerAccount ?? "missing"}`);
  if (makerAccount === null) return 1;

  const info = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPerpetualInfoV2",
    args: [PERP_BTC],
  })) as {
    symbol: string;
    priceDecimals: bigint;
    lotDecimals: bigint;
    markPNS: bigint;
    basePricePNS: bigint;
    maxBidPriceONS: bigint;
    minAskPriceONS: bigint;
  };
  if (info.symbol !== "BTC") {
    console.error(`perp 16 symbol=${info.symbol}`);
    return 1;
  }

  await flattenAccount({
    client,
    wallet: makerWallet,
    account: maker,
    target: exchange,
    exchange,
    accountId: makerAccount,
    info,
    kind: "maker",
  });

  if (!state.liquidity || state.liquidity.startsWith("reverted")) {
    state.liquidity = await tryExistingLiquidity({
      client,
      ownerWallet,
      owner,
      proxy,
      exchange,
      proxyAccount,
      info,
    });
    saveState(root, state);
  }
  console.log(`liquidity ${state.liquidity}`);

  let openHash = state.selfMatch;
  let matched = false;
  for (let attempt = 1; attempt <= 3 && !matched; attempt++) {
    const book = await btcPerp(client, exchange);
    await flattenAccount({
      client,
      wallet: makerWallet,
      account: maker,
      target: exchange,
      exchange,
      accountId: makerAccount,
      info: book,
      kind: "maker",
    });
    await flattenAccount({
      client,
      wallet: ownerWallet,
      account: owner,
      target: proxy,
      exchange,
      accountId: proxyAccount,
      info: book,
      kind: "proxy",
    });
    const live = await btcPerp(client, exchange);
    const ask = restingAskPricePNS({
      markPNS: live.markPNS,
      basePricePNS: live.basePricePNS,
      maxBidPriceONS: live.maxBidPriceONS,
      minAskPriceONS: live.minAskPriceONS,
    });
    console.log(
      `attempt ${attempt} mark=${live.markPNS} bid=${bookPricePNS(live.basePricePNS, live.maxBidPriceONS)} ask=${bookPricePNS(live.basePricePNS, live.minAskPriceONS)} resting=${ask}`,
    );
    await sendContract({
      client,
      wallet: makerWallet,
      account: maker,
      address: exchange,
      abi: exchangeAbi,
      functionName: "execOrder",
      args: [
        orderDesc({
          perpId: PERP_BTC,
          orderType: ORDER_OPEN_SHORT,
          pricePNS: ask,
          lotLNS: REQUEST_LOT,
          leverageHdths: TARGET_LEVERAGE_HDTHS,
          postOnly: true,
        }),
      ],
      kind: "maker.postOnly",
    });
    try {
      const open = await sendContract({
        client,
        wallet: ownerWallet,
        account: owner,
        address: proxy,
        abi: exchangeAbi,
        functionName: "execOrder",
        args: [
          orderDesc({
            perpId: PERP_BTC,
            orderType: ORDER_OPEN_LONG,
            pricePNS: ask,
            lotLNS: REQUEST_LOT,
            leverageHdths: TARGET_LEVERAGE_HDTHS,
            immediateOrCancel: true,
            maxMatches: 1n,
          }),
        ],
        kind: "proxy.iocOpen",
      });
      openHash = open.hash;
    } catch (error) {
      const message = error instanceof Error ? (error.message.split("\n")[0] ?? "reverted") : "reverted";
      console.log(`attempt ${attempt} ioc ${message.slice(0, 160)}`);
    }
    const proxyLot = (await positionOf(client, exchange, proxyAccount)).lotLNS;
    const makerLot = (await positionOf(client, exchange, makerAccount)).lotLNS;
    matched = proxyLot > 0n && makerLot > 0n;
    console.log(`attempt ${attempt} proxyLot=${proxyLot} makerLot=${makerLot}`);
  }
  state.selfMatch = openHash;
  saveState(root, state);

  const proxyPosition = await positionOf(client, exchange, proxyAccount);
  const makerPosition = await positionOf(client, exchange, makerAccount);
  const lev = leverageHdths({
    pricePNS: proxyPosition.pricePNS,
    priceDecimals: Number(info.priceDecimals),
    lotLNS: proxyPosition.lotLNS,
    lotDecimals: Number(info.lotDecimals),
    depositCNS: proxyPosition.depositCNS,
  });
  const lotOk =
    proxyPosition.lotLNS >= REQUEST_LOT - 1n && proxyPosition.lotLNS <= REQUEST_LOT + 1n;
  const sideOk = proxyPosition.positionType === 0 && makerPosition.positionType === 1;
  const levOk = lev >= TARGET_LEVERAGE_HDTHS - 50n && lev <= TARGET_LEVERAGE_HDTHS + 50n;
  const makerLotOk = makerPosition.lotLNS >= REQUEST_LOT - 1n && makerPosition.lotLNS <= REQUEST_LOT + 1n;
  console.log(
    `proxy type=${proxyPosition.positionType} lot=${proxyPosition.lotLNS} deposit=${proxyPosition.depositCNS} entry=${proxyPosition.pricePNS} leverageHdths=${lev} maker type=${makerPosition.positionType} lot=${makerPosition.lotLNS} lotOk=${lotOk} sideOk=${sideOk} levOk=${levOk} makerLotOk=${makerLotOk}`,
  );
  return lotOk && sideOk && levOk && makerLotOk ? 0 : 1;
}

async function btcPerp(client: PublicClient, exchange: Address) {
  return (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPerpetualInfoV2",
    args: [PERP_BTC],
  })) as {
    symbol: string;
    priceDecimals: bigint;
    lotDecimals: bigint;
    markPNS: bigint;
    basePricePNS: bigint;
    maxBidPriceONS: bigint;
    minAskPriceONS: bigint;
  };
}

async function flattenAccount(args: {
  client: PublicClient;
  wallet: ReturnType<typeof testnetWallet>;
  account: ReturnType<typeof loadRoles>["MAKER"];
  target: Address;
  exchange: Address;
  accountId: bigint;
  info: { basePricePNS: bigint; maxBidPriceONS: bigint; minAskPriceONS: bigint };
  kind: string;
}) {
  const locks = (await args.client.readContract({
    address: args.exchange,
    abi: exchangeAbi,
    functionName: "getPerpOrderLocks",
    args: [args.accountId, PERP_BTC],
  })) as readonly { orderLockId: number; lotLNS: bigint }[];
  for (const lock of locks) {
    const orderId = BigInt(lock.orderLockId);
    if (orderId === 0n) continue;
    await sendContract({
      client: args.client,
      wallet: args.wallet,
      account: args.account,
      address: args.target,
      abi: exchangeAbi,
      functionName: "execOrder",
      args: [
        orderDesc({
          perpId: PERP_BTC,
          orderType: ORDER_CANCEL,
          orderId,
          pricePNS: 1n,
          lotLNS: BigInt(lock.lotLNS) === 0n ? 1n : BigInt(lock.lotLNS),
          leverageHdths: TARGET_LEVERAGE_HDTHS,
        }),
      ],
      kind: `${args.kind}.cancel`,
    });
  }
  const position = await positionOf(args.client, args.exchange, args.accountId);
  if (position.lotLNS === 0n) return;
  const short = position.positionType === 1;
  const price = bookPricePNS(
    args.info.basePricePNS,
    short ? args.info.minAskPriceONS : args.info.maxBidPriceONS,
  );
  await sendContract({
    client: args.client,
    wallet: args.wallet,
    account: args.account,
    address: args.target,
    abi: exchangeAbi,
    functionName: "execOrder",
    args: [
      orderDesc({
        perpId: PERP_BTC,
        orderType: short ? ORDER_CLOSE_SHORT : ORDER_CLOSE_LONG,
        pricePNS: price === 0n ? args.info.basePricePNS : price,
        lotLNS: position.lotLNS,
        leverageHdths: TARGET_LEVERAGE_HDTHS,
        immediateOrCancel: true,
        maxMatches: 5n,
      }),
    ],
    kind: `${args.kind}.flatten`,
  });
}

async function tryExistingLiquidity(args: {
  client: PublicClient;
  ownerWallet: ReturnType<typeof testnetWallet>;
  owner: ReturnType<typeof loadRoles>["POOL_OWNER"];
  proxy: Address;
  exchange: Address;
  proxyAccount: bigint;
  info: { basePricePNS: bigint; maxBidPriceONS: bigint; minAskPriceONS: bigint };
}): Promise<string> {
  if (args.info.minAskPriceONS === 0n) return "no resting ask";
  const price = bookPricePNS(args.info.basePricePNS, args.info.minAskPriceONS);
  try {
    const open = await sendContract({
      client: args.client,
      wallet: args.ownerWallet,
      account: args.owner,
      address: args.proxy,
      abi: exchangeAbi,
      functionName: "execOrder",
      args: [
        orderDesc({
          perpId: PERP_BTC,
          orderType: ORDER_OPEN_LONG,
          pricePNS: price,
          lotLNS: REQUEST_LOT,
          leverageHdths: TARGET_LEVERAGE_HDTHS,
          immediateOrCancel: true,
        }),
      ],
      kind: "proxy.liquidityIoc",
    });
    const opened = await positionOf(args.client, args.exchange, args.proxyAccount);
    if (opened.lotLNS === 0n) return `no fill gas=${open.gasUsed}`;
    const bid = bookPricePNS(args.info.basePricePNS, args.info.maxBidPriceONS);
    await sendContract({
      client: args.client,
      wallet: args.ownerWallet,
      account: args.owner,
      address: args.proxy,
      abi: exchangeAbi,
      functionName: "execOrder",
      args: [
        orderDesc({
          perpId: PERP_BTC,
          orderType: ORDER_CLOSE_LONG,
          pricePNS: bid === 0n ? price : bid,
          lotLNS: opened.lotLNS,
          leverageHdths: TARGET_LEVERAGE_HDTHS,
          immediateOrCancel: true,
        }),
      ],
      kind: "proxy.liquidityClose",
    });
    const left = await positionOf(args.client, args.exchange, args.proxyAccount);
    return `filled lot=${opened.lotLNS} then closed remaining=${left.lotLNS} gas=${open.gasUsed}`;
  } catch (error) {
    const message = error instanceof Error ? (error.message.split("\n")[0] ?? "reverted") : "reverted";
    return `reverted ${message.slice(0, 180)}`;
  }
}
