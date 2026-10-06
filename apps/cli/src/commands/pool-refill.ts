import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ADDRESSES,
  TESTNET_ID,
  contractDistanceE6,
  delegatedAccountAbi,
  exchangeAbi,
  readAccountByAddr,
  readPositionsForAccount,
} from "@lifeline/core";
import { getAddress, type Address, type PublicClient } from "viem";
import { nextRefillSide, type RefillInventory, type RefillTarget } from "../refill-plan.js";
import { loadRoles } from "../roles.js";
import { testnetPublicClient } from "../testnet.js";
import { workspaceRoot } from "./keys-generate.js";
import { addPoolAccount, type PoolAccount, type PoolMarket, type PoolSide } from "./pool-create.js";
import { poolRegister } from "./pool-register.js";

const DEMO_LOW = 25_000n;
const DEMO_HIGH = 35_000n;
const RESERVE = 60_000n;
const DEFAULT_TARGET: RefillTarget = { available: 30, perSide: 12, inBand: 10 };

interface PoolFile {
  accounts?: { proxy?: string; market?: string; side?: string; perpId?: string }[];
}

function option(argv: readonly string[], name: string, fallback: number): number {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(argv[index + 1]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function marketOf(client: PublicClient, perpId: bigint) {
  const exchange = ADDRESSES[TESTNET_ID].exchange;
  const packed = await client.multicall({
    contracts: [
      { address: exchange, abi: exchangeAbi, functionName: "getPerpetualInfoV2", args: [perpId] },
      { address: exchange, abi: exchangeAbi, functionName: "getMarginFractions", args: [perpId, 0n] },
    ],
    allowFailure: false,
  });
  const info = packed[0] as { priceDecimals: bigint; lotDecimals: bigint };
  const fractions = packed[1];
  const hdths = Array.isArray(fractions)
    ? (fractions[1] as bigint)
    : (fractions as { perpMaintMarginFracHdths: bigint }).perpMaintMarginFracHdths;
  return { priceDecimals: Number(info.priceDecimals), lotDecimals: Number(info.lotDecimals), maintHdths: hdths };
}

async function measure(client: PublicClient, account: PoolAccount, poolOwner: Address): Promise<{
  free: boolean;
  side: PoolSide;
  inBand: boolean;
} | null> {
  const proxy = getAddress(account.proxy);
  const [owner, pending] = await Promise.all([
    client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "owner" }),
    client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "pendingOwner" }),
  ]);
  if (getAddress(owner) !== poolOwner) return null;
  if (getAddress(pending) !== "0x0000000000000000000000000000000000000000") return null;
  const exchange = ADDRESSES[TESTNET_ID].exchange;
  const info = await readAccountByAddr(client, exchange, proxy);
  const positions = await readPositionsForAccount(client, exchange, info.accountId);
  const position = positions.find((item) => BigInt(item.perpId) === BigInt(account.perpId));
  if (!position || position.position.lotLNS <= 0n) return null;
  const market = await marketOf(client, BigInt(account.perpId));
  const distance = contractDistanceE6(
    {
      positionType: position.position.positionType,
      pricePNS: position.position.pricePNS,
      lotLNS: position.position.lotLNS,
      depositCNS: position.position.depositCNS,
      premiumPnlCNS: position.position.premiumPnlCNS,
    },
    market,
    position.markPricePNS,
  );
  if (distance > RESERVE) return null;
  return {
    free: true,
    side: account.side,
    inBand: distance >= DEMO_LOW && distance <= DEMO_HIGH,
  };
}

async function inventory(client: PublicClient, accounts: PoolAccount[], poolOwner: Address): Promise<RefillInventory> {
  const counts: RefillInventory = { available: 0, long: 0, short: 0, inBand: 0 };
  for (const account of accounts) {
    const row = await measure(client, account, poolOwner);
    if (!row) continue;
    counts.available += 1;
    if (row.side === "long") counts.long += 1;
    else counts.short += 1;
    if (row.inBand) counts.inBand += 1;
  }
  return counts;
}

export async function poolRefill(root = workspaceRoot(), argv: readonly string[] = []): Promise<number> {
  const target: RefillTarget = {
    available: option(argv, "--target", DEFAULT_TARGET.available),
    perSide: option(argv, "--per-side", DEFAULT_TARGET.perSide),
    inBand: option(argv, "--in-band", DEFAULT_TARGET.inBand),
  };
  const file = path.join(root, "cli-state", "pool.json");
  const saved = JSON.parse(readFileSync(file, "utf8")) as PoolFile;
  const accounts: PoolAccount[] = (saved.accounts ?? []).flatMap((account) => {
    if (!account.proxy || !account.market || !account.side || !account.perpId) return [];
    if (account.market !== "BTC" && account.market !== "ETH") return [];
    if (account.side !== "long" && account.side !== "short") return [];
    return [{ proxy: getAddress(account.proxy), market: account.market, side: account.side, perpId: account.perpId }];
  });
  const client = testnetPublicClient();
  const poolOwner = loadRoles(root).POOL_OWNER.address;
  let counts = await inventory(client, accounts, poolOwner);
  console.log(`pool:refill available=${counts.available} long=${counts.long} short=${counts.short} inBand=${counts.inBand}`);
  let created = 0;
  let guard = 0;
  while (guard < target.available + 20) {
    const side = nextRefillSide(counts, target);
    if (!side) break;
    guard += 1;
    const account = await addPoolAccount(root, "BTC" as PoolMarket, side);
    created += 1;
    const row = await measure(client, account, poolOwner);
    if (!row) {
      console.log(`pool:refill ${account.proxy} not countable`);
      continue;
    }
    counts = {
      available: counts.available + 1,
      long: counts.long + (row.side === "long" ? 1 : 0),
      short: counts.short + (row.side === "short" ? 1 : 0),
      inBand: counts.inBand + (row.inBand ? 1 : 0),
    };
    console.log(`pool:refill available=${counts.available} long=${counts.long} short=${counts.short} inBand=${counts.inBand}`);
  }
  if (created === 0) {
    console.log("pool:refill nothing new");
    return nextRefillSide(counts, target) === null ? 0 : 1;
  }
  const registered = await poolRegister(root);
  if (registered !== 0) return registered;
  console.log(`pool:refill done available=${counts.available} long=${counts.long} short=${counts.short} inBand=${counts.inBand}`);
  return nextRefillSide(counts, target) === null ? 0 : 1;
}
