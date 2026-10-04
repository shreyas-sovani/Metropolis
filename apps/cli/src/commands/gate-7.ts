import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ADDRESSES,
  GAS_LIMITS,
  ORDER_OPEN_LONG,
  TESTNET_ID,
  assignOperatorTypes,
  bookPricePNS,
  delegatedAccountAbi,
  delegatedAccountFactoryAbi,
  erc20Abi,
  exchangeAbi,
  factoryDomain,
  faucetAbi,
  orderDesc,
} from "@lifeline/core";
import {
  decodeEventLog,
  formatEther,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { WEI } from "../funding.js";
import { loadRoles } from "../roles.js";
import { recordGas, sendContract } from "../send.js";
import { testnetPublicClient, testnetWallet } from "../testnet.js";
import { workspaceRoot } from "./keys-generate.js";

const PERP_BTC = 16n;
const ONE_AUSD = 1_000_000n;
const MIN_OPEN = 100n * ONE_AUSD;
const DRIP = 8n * 10n ** 16n;
const SPONSOR_FLOOR = 3n * WEI;
const RUNS = 3;

const SOURCES: Record<string, readonly string[]> = {
  factoryCreate: ["factory.create"],
  ausdTransfer: ["ausd.transfer"],
  createAccount: ["proxy.createAccount", "maker.createAccount"],
  setOperatorAllowlist: [
    "allowlist.execOrder",
    "allowlist.execOrders",
    "allowlist.requestDecreasePositionCollateral",
    "allowlist.buyLiquidations",
    "allowlist.depositCollateral",
    "allowlist.allowOrderForwarding",
  ],
  execOrderOpen: ["proxy.iocOpen"],
  increasePositionCollateral: ["operator.increasePositionCollateral"],
  transferOwnership: ["transferOwnership"],
  acceptOwnership: ["acceptOwnership"],
  withdrawCollateral: ["owner.withdrawCollateral"],
  monDrip: ["mon.drip"],
  faucetRequestFunds: ["faucet.requestFunds"],
};

function gasLog(root: string): { kind: string; gasUsed: string; status: number }[] {
  try {
    const parsed = JSON.parse(readFileSync(path.join(root, "cli-state", "gas-log.json"), "utf8")) as {
      entries: { kind: string; gasUsed: string; status: number }[];
    };
    return parsed.entries;
  } catch {
    return [];
  }
}

function hasKind(root: string, kind: string) {
  return gasLog(root).some((entry) => entry.kind === kind && entry.status === 1);
}

function requiredLimits(root: string): Record<string, bigint> {
  const entries = gasLog(root);
  const limits: Record<string, bigint> = {};
  for (const [name, kinds] of Object.entries(SOURCES)) {
    const samples = entries.filter((entry) => entry.status === 1 && kinds.includes(entry.kind));
    if (samples.length === 0) throw new Error(`no gas sample for ${name}`);
    const max = samples.reduce((highest, entry) => {
      const gas = BigInt(entry.gasUsed);
      return gas > highest ? gas : highest;
    }, 0n);
    limits[name] = (max * 12n + 9n) / 10n;
  }
  return limits;
}

function proxyFromReceipt(receipt: { logs: { data: Hex; topics: Hex[] }[] }): Address {
  for (const log of receipt.logs) {
    if (log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({
        abi: delegatedAccountFactoryAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName === "DelegatedAccountCreated") return decoded.args.proxy;
    } catch {
      continue;
    }
  }
  throw new Error("proxy missing");
}

async function waitForFaucet(client: PublicClient, faucet: Address) {
  const last = (await client.readContract({
    address: faucet,
    abi: faucetAbi,
    functionName: "lastDripTimestamp",
  })) as bigint;
  const frequency = (await client.readContract({
    address: faucet,
    abi: faucetAbi,
    functionName: "maxDripFrequency",
  })) as bigint;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const readyAt = last + frequency;
  if (now < readyAt) {
    const waitMs = Number(readyAt - now + 1n) * 1000;
    console.log(`faucet cooldown ${waitMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

export async function gate7(root = workspaceRoot()): Promise<number> {
  await ensureSamples(root);
  const required = requiredLimits(root);
  const configured = GAS_LIMITS as Record<string, bigint>;
  const names = Object.keys(SOURCES);
  const mismatch = names.filter((name) => configured[name] !== required[name]);
  if (mismatch.length > 0 || Object.keys(configured).length !== names.length) {
    console.log("GAS_LIMITS must be:");
    for (const name of names) console.log(`  ${name}: ${required[name]}n`);
    return 1;
  }

  const client = testnetPublicClient();
  const block = await client.getBlock();
  const base = block.baseFeePerGas ?? 0n;
  console.log(`baseFeePerGas=${base}`);
  for (const name of names) {
    const gas = configured[name];
    if (gas === undefined) return 1;
    const cost = gas * base;
    console.log(`cost ${name} gas=${gas} mon=${formatEther(cost)}`);
  }

  for (let run = 1; run <= RUNS; run++) {
    const code = await confirmOnce(root, run);
    if (code !== 0) return code;
  }
  return 0;
}

async function ensureSamples(root: string) {
  const roles = loadRoles(root);
  const client = testnetPublicClient();
  const addresses = ADDRESSES[TESTNET_ID];
  const factory = addresses.factory;
  const faucet = addresses.faucet;
  if (!factory || !faucet) throw new Error("testnet factory or faucet missing");
  const proxy = proxyOf(root);
  const owner = roles.POOL_OWNER;
  const testOwner = roles.TEST_OWNER;
  const sponsor = roles.SPONSOR;

  if (!hasKind(root, "transferOwnership")) {
    const ownerWallet = testnetWallet(owner);
    const moved = await sendContract({
      client,
      wallet: ownerWallet,
      account: owner,
      address: proxy,
      abi: delegatedAccountAbi,
      functionName: "transferOwnership",
      args: [testOwner.address],
      kind: "transferOwnership",
    });
    if (moved.status !== 1) throw new Error("transferOwnership failed");
    const accepted = await sendContract({
      client,
      wallet: testnetWallet(testOwner),
      account: testOwner,
      address: proxy,
      abi: delegatedAccountAbi,
      functionName: "acceptOwnership",
      args: [],
      kind: "acceptOwnership",
    });
    if (accepted.status !== 1) throw new Error("acceptOwnership failed");
    await sendContract({
      client,
      wallet: testnetWallet(testOwner),
      account: testOwner,
      address: proxy,
      abi: delegatedAccountAbi,
      functionName: "transferOwnership",
      args: [owner.address],
      kind: "transferOwnership",
    });
    await sendContract({
      client,
      wallet: ownerWallet,
      account: owner,
      address: proxy,
      abi: delegatedAccountAbi,
      functionName: "acceptOwnership",
      args: [],
      kind: "acceptOwnership",
    });
    const restored = (await client.readContract({
      address: proxy,
      abi: delegatedAccountAbi,
      functionName: "owner",
    })) as Address;
    if (restored.toLowerCase() !== owner.address.toLowerCase()) {
      throw new Error(`proxy owner is ${restored}`);
    }
    console.log(`ownership restored ${restored}`);
  }

  if (!hasKind(root, "mon.drip")) {
    const sponsorWallet = testnetWallet(sponsor);
    const balance = await client.getBalance({ address: sponsor.address });
    if (balance < SPONSOR_FLOOR + DRIP) throw new Error("sponsor below floor for a drip");
    const gas = 30_000n;
    const hash = await sponsorWallet.sendTransaction({
      account: sponsor,
      chain: sponsorWallet.chain,
      to: testOwner.address,
      value: DRIP,
      gas,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    const status = receipt.status === "success" ? 1 : 0;
    console.log(`mon.drip tx ${hash} status=${status} gas=${receipt.gasUsed}`);
    recordGas("mon.drip", hash, receipt.gasUsed, status, root);
    if (status !== 1) throw new Error("drip failed");
  }

  if (!hasKind(root, "faucet.requestFunds")) {
    await waitForFaucet(client, faucet);
    await sendContract({
      client,
      wallet: testnetWallet(sponsor),
      account: sponsor,
      address: faucet,
      abi: faucetAbi,
      functionName: "requestFunds",
      args: [owner.address],
      kind: "faucet.requestFunds",
    });
  }
}

function proxyOf(root: string): Address {
  const state = JSON.parse(readFileSync(path.join(root, "cli-state", "gate-6.json"), "utf8")) as {
    proxy?: Address;
  };
  if (!state.proxy) throw new Error("gate-6 proxy missing");
  return state.proxy;
}

async function confirmOnce(root: string, run: number): Promise<number> {
  const limits = GAS_LIMITS as Record<string, bigint>;
  const roles = loadRoles(root);
  const client = testnetPublicClient();
  const addresses = ADDRESSES[TESTNET_ID];
  const exchange = addresses.exchange;
  const factory = addresses.factory;
  const ausd = addresses.ausd;
  const faucet = addresses.faucet;
  if (!factory || !ausd || !faucet) throw new Error("testnet addresses missing");
  const owner = roles.POOL_OWNER;
  const operator = roles.OPERATOR;
  const testOwner = roles.TEST_OWNER;
  const sponsor = roles.SPONSOR;
  const ownerWallet = testnetWallet(owner);
  const g6 = proxyOf(root);

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
    gas: limits.factoryCreate,
  });
  const proxy = proxyFromReceipt(created.receipt);
  await sendContract({
    client,
    wallet: ownerWallet,
    account: owner,
    address: ausd,
    abi: erc20Abi,
    functionName: "transfer",
    args: [proxy, MIN_OPEN],
    kind: "ausd.transfer",
    gas: limits.ausdTransfer,
  });
  await sendContract({
    client,
    wallet: ownerWallet,
    account: owner,
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "createAccount",
    args: [MIN_OPEN],
    kind: "proxy.createAccount",
    gas: limits.createAccount,
  });
  await sendContract({
    client,
    wallet: ownerWallet,
    account: owner,
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "setOperatorAllowlist",
    args: [selector("execOrder"), false],
    kind: "allowlist.execOrder",
    gas: limits.setOperatorAllowlist,
  });

  const info = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPerpetualInfoV2",
    args: [PERP_BTC],
  })) as { basePricePNS: bigint; minAskPriceONS: bigint; markPNS: bigint };
  const price =
    info.minAskPriceONS === 0n ? info.markPNS : bookPricePNS(info.basePricePNS, info.minAskPriceONS);
  await sendContract({
    client,
    wallet: ownerWallet,
    account: owner,
    address: g6,
    abi: exchangeAbi,
    functionName: "execOrder",
    args: [
      orderDesc({
        perpId: PERP_BTC,
        orderType: ORDER_OPEN_LONG,
        pricePNS: price,
        lotLNS: 100n,
        leverageHdths: 1500n,
        immediateOrCancel: true,
      }),
    ],
    kind: "proxy.iocOpen",
    gas: limits.execOrderOpen,
  });
  await sendContract({
    client,
    wallet: testnetWallet(operator),
    account: operator,
    address: g6,
    abi: exchangeAbi,
    functionName: "increasePositionCollateral",
    args: [PERP_BTC, ONE_AUSD],
    kind: "operator.increasePositionCollateral",
    gas: limits.increasePositionCollateral,
  });
  await sendContract({
    client,
    wallet: ownerWallet,
    account: owner,
    address: g6,
    abi: delegatedAccountAbi,
    functionName: "withdrawCollateral",
    args: [ONE_AUSD],
    kind: "owner.withdrawCollateral",
    gas: limits.withdrawCollateral,
  });
  await sendContract({
    client,
    wallet: ownerWallet,
    account: owner,
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "transferOwnership",
    args: [testOwner.address],
    kind: "transferOwnership",
    gas: limits.transferOwnership,
  });
  await sendContract({
    client,
    wallet: testnetWallet(testOwner),
    account: testOwner,
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "acceptOwnership",
    args: [],
    kind: "acceptOwnership",
    gas: limits.acceptOwnership,
  });

  const balance = await client.getBalance({ address: sponsor.address });
  if (balance < SPONSOR_FLOOR + DRIP) {
    console.error("sponsor would breach the 3 MON floor");
    return 1;
  }
  const sponsorWallet = testnetWallet(sponsor);
  const hash = await sponsorWallet.sendTransaction({
    account: sponsor,
    chain: sponsorWallet.chain,
    to: testOwner.address,
    value: DRIP,
    gas: limits.monDrip,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const status = receipt.status === "success" ? 1 : 0;
  console.log(`mon.drip tx ${hash} status=${status} gas=${receipt.gasUsed}`);
  recordGas("mon.drip", hash, receipt.gasUsed, status, root);
  if (status !== 1) return 1;

  await waitForFaucet(client, faucet);
  await sendContract({
    client,
    wallet: sponsorWallet,
    account: sponsor,
    address: faucet,
    abi: faucetAbi,
    functionName: "requestFunds",
    args: [owner.address],
    kind: "faucet.requestFunds",
    gas: limits.faucetRequestFunds,
  });
  console.log(`confirm ${run} ok proxy=${proxy}`);
  return 0;
}

function selector(name: string): Hex {
  const item = exchangeAbi.find((entry) => entry.type === "function" && entry.name === name);
  if (!item || item.type !== "function") throw new Error(name);
  return toFunctionSelector(item);
}
