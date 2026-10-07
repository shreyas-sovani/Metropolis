import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { lotSums } from "../src/chain/positions.js";
import { openChain } from "../src/chain/api.js";
import { PUBLIC_RPC_URLS } from "../src/config/chains.js";
import { ADDRESSES } from "../src/config/addresses.js";
import { blocksForDays, liquidationHistory } from "../src/hypersync/analytics.js";
import { forfeitCNS } from "../src/radar/penalty.js";
import { radarSalt } from "../src/radar/anonymize.js";
import { buildSnapshot } from "../src/radar/snapshot.js";
import { radarSnapshotSchema } from "../src/radar/schema.js";
import {
  acceptOwnershipTx,
  ausdTransferTx,
  createAccountTx,
  factoryCreateTx,
  increasePositionCollateralTx,
  iocOpenTx,
  revokeOperatorAllowlistTxs,
  transferOwnershipTx,
  withdrawCollateralTx,
  type TxRequest,
} from "../src/tx/builders.js";
import { ORDER_OPEN_LONG, orderDesc } from "../src/orders/index.js";
import { delegatedAccountFactoryAbi } from "../src/abi/delegatedAccountFactory.js";
import { assignOperatorTypes, factoryDomain } from "../src/orders/consent.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const G1_PROXY = "0xEc73AFB31b20729160c247A3009C193a4842e95A" as const;

function envValue(file: string, name: string): string {
  for (const line of readFileSync(path.join(root, "secrets", file), "utf8").split("\n")) {
    if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).trim();
  }
  throw new Error(`${name} missing`);
}

function roleAddress(name: string): Address {
  const key = envValue("testnet-keys.env", name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${name} missing`);
  return privateKeyToAccount(key as Hex).address;
}

describe("live chain readers", () => {
  it("reads mainnet and testnet, and survives a dead primary RPC", async () => {
    const mainnet = openChain(143);
    const perps = await mainnet.listPerps();
    expect(perps.length).toBeGreaterThan(0);
    const markets = await mainnet.readAllPositions();
    expect(markets.length).toBe(perps.length);
    for (const market of markets) {
      const sums = lotSums(market.positions);
      expect(sums.longOpenInterestLNS).toBe(market.info.longOpenInterestLNS);
      expect(sums.shortOpenInterestLNS).toBe(market.info.shortOpenInterestLNS);
      expect(BigInt(market.positions.length)).toBe(market.numPositions);
    }
    const first = perps[0];
    if (!first) throw new Error("no perp");
    const one = await mainnet.readMarket(first.perpId);
    expect(one.info.perpId).toBe(first.perpId);
    const sample = markets.flatMap((market) => market.positions.map((position) => position.accountId))[0];
    if (sample === undefined) throw new Error("no position");
    const [account] = await mainnet.readAccounts([sample]);
    if (!account) throw new Error("missing account");
    const byAddr = await mainnet.readAccountByAddr(account.accountAddr);
    expect(byAddr.accountId).toBe(account.accountId);
    const positions = await mainnet.readPositionsForAccount(account.accountId);
    expect(positions.length).toBeGreaterThan(0);

    const testnet = openChain(10143);
    expect((await testnet.listPerps()).length).toBeGreaterThan(0);
    const testMarkets = await testnet.readAllPositions();
    for (const market of testMarkets) {
      const sums = lotSums(market.positions);
      expect(sums.longOpenInterestLNS).toBe(market.info.longOpenInterestLNS);
      expect(sums.shortOpenInterestLNS).toBe(market.info.shortOpenInterestLNS);
    }
    const proxyPositions = await testnet.readPositionsForAccount(816n);
    expect(proxyPositions.some((position) => position.perpId === 16 && position.position.lotLNS > 0n)).toBe(true);

    const fallback = openChain(143, {
      urls: ["http://127.0.0.1:9", ...PUBLIC_RPC_URLS[143]],
      timeout: 1_500,
    });
    expect((await fallback.listPerps()).length).toBeGreaterThan(0);
  }, 90_000);
});

describe("live radar", () => {
  it("validates a mainnet snapshot within 6 seconds", async () => {
    const salt = radarSalt(envValue("services.env", "RADAR_SALT"));
    const started = Date.now();
    const snapshot = buildSnapshot(143, salt);
    const value = await snapshot;
    const elapsed = Date.now() - started;
    console.log(`radar cold ms=${elapsed} markets=${value.markets.length} positions=${value.positions.length}`);
    expect(elapsed).toBeLessThanOrEqual(6_000);
    expect(radarSnapshotSchema.parse(value)).toBeTruthy();
    expect(BigInt(value.headline.openInterestMicro)).toBe(
      value.markets.reduce((sum, market) => sum + BigInt(market.openInterestMicro), 0n),
    );
    expect(value.headline.positionCount).toBe(value.markets.reduce((sum, market) => sum + market.positionCount, 0));
    expect(value.headline.atRiskCount).toBe(value.markets.reduce((sum, market) => sum + market.atRiskCount, 0));
    expect(BigInt(value.headline.idleMicro)).toBe(value.markets.reduce((sum, market) => sum + BigInt(market.idleMicro), 0n));
    const json = JSON.stringify(value);
    expect(json).not.toMatch(/0x[0-9a-fA-F]{40}/);
  }, 30_000);
});

describe("live transaction simulation", () => {
  it("matches the G1 allowlist on the proxy", async () => {
    const client = openChain(10143).client;
    const owner = roleAddress("POOL_OWNER_PK");
    const operator = roleAddress("OPERATOR_PK");
    const maker = roleAddress("MAKER_PK");
    async function ok(from: Address, tx: TxRequest): Promise<boolean> {
      try {
        await client.call({ account: from, to: tx.to, data: tx.data, gas: tx.gas, value: tx.value });
        return true;
      } catch {
        return false;
      }
    }
    expect(await ok(operator, increasePositionCollateralTx(G1_PROXY, 16n, 1n))).toBe(true);
    expect(await ok(maker, increasePositionCollateralTx(G1_PROXY, 16n, 1n))).toBe(false);
    expect(await ok(owner, withdrawCollateralTx(G1_PROXY, 1n))).toBe(true);
    expect(await ok(operator, withdrawCollateralTx(G1_PROXY, 1n))).toBe(false);
    expect(await ok(owner, transferOwnershipTx(G1_PROXY, maker))).toBe(true);
    expect(await ok(operator, transferOwnershipTx(G1_PROXY, maker))).toBe(false);
    expect(await ok(owner, acceptOwnershipTx(G1_PROXY))).toBe(false);
    expect(await ok(operator, acceptOwnershipTx(G1_PROXY))).toBe(false);
    const revoke = revokeOperatorAllowlistTxs(G1_PROXY);
    expect(revoke).toHaveLength(6);
    expect(await ok(owner, revoke[0]!)).toBe(true);
    expect(await ok(operator, revoke[0]!)).toBe(false);
    const order = orderDesc({
      perpId: 16n,
      orderType: ORDER_OPEN_LONG,
      pricePNS: 1n,
      lotLNS: 1n,
      leverageHdths: 1500n,
    });
    expect(await ok(operator, iocOpenTx(G1_PROXY, order))).toBe(false);
    expect(await ok(owner, createAccountTx(G1_PROXY, 1n))).toBe(false);
    const ausd = ADDRESSES[10143].ausd;
    if (!ausd) throw new Error("testnet AUSD missing");
    expect(await ok(owner, ausdTransferTx(ausd, maker, 0n))).toBe(true);
    const operatorKey = envValue("testnet-keys.env", "OPERATOR_PK") as Hex;
    const factory = ADDRESSES[10143].factory;
    if (!factory) throw new Error("factory missing");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const nonce = (await client.readContract({
      address: factory,
      abi: delegatedAccountFactoryAbi,
      functionName: "operatorNonces",
      args: [operator],
    })) as bigint;
    const signature = await privateKeyToAccount(operatorKey).signTypedData({
      domain: factoryDomain(factory, 10143),
      types: assignOperatorTypes,
      primaryType: "AssignOperator",
      message: { owner, nonce, deadline },
    });
    const created = await ok(owner, factoryCreateTx(factory, operator, deadline, signature));
    console.log(`factory.create eth_call ok=${created}`);
    expect(created).toBe(true);
  }, 60_000);
});

describe("live hypersync analytics", () => {
  it("returns mainnet liquidation history within 5 seconds", async () => {
    const token = envValue("services.env", "ENVIO_API_TOKEN");
    const chain = openChain(143);
    const latest = await chain.client.getBlock();
    const earlier = await chain.client.getBlock({ blockNumber: latest.number - 5_000n });
    const span = blocksForDays(latest.number, latest.timestamp, earlier.number, earlier.timestamp, 30);
    const fromBlock = Number(latest.number > span ? latest.number - span : 0n);
    const perps = await chain.listPerps();
    const scales = new Map(
      perps.map((perp) => [
        String(perp.perpId),
        { priceDecimals: perp.priceDecimals, lotDecimals: perp.lotDecimals, symbol: perp.symbol || perp.name },
      ]),
    );
    const started = Date.now();
    const history = await liquidationHistory({
      chainId: 143,
      days: 30,
      token,
      fromBlock,
      scales,
      fetchImpl: fetch,
    });
    const elapsed = Date.now() - started;
    console.log(`liquidations rows=${history.totals.count} ms=${elapsed} from=${fromBlock}`);
    expect(elapsed).toBeLessThanOrEqual(5_000);
    expect(history.totals.count).toBe(history.rows.length);
    expect(BigInt(history.totals.notionalMicro)).toBe(
      history.rows.reduce((sum, row) => sum + BigInt(row.notionalMicro), 0n),
    );
    expect(history.latest.length).toBeLessThanOrEqual(50);
    expect(history.eligible.count).toBeLessThan(history.totals.count);
    const byPerp = new Map(perps.map((perp) => [String(perp.perpId), perp]));
    for (const row of history.latest) {
      const perp = byPerp.get(row.perpId);
      expect(perp, row.perpId).toBeTruthy();
      const expected = (BigInt(row.markPricePNS) * BigInt(row.liqLotLNS) * 1_000_000n) / 10n ** BigInt((perp?.priceDecimals ?? 0) + (perp?.lotDecimals ?? 0));
      expect(BigInt(row.notionalMicro)).toBe(expected);
      expect(row.symbol.length).toBeGreaterThan(0);
      expect(row.side === "long" || row.side === "short").toBe(true);
    }
    const split = { userPer100K: 80_000n, insPer100K: 10_000n, protocolPer100K: 10_000n };
    let paid = 0n;
    let avoidable = 0n;
    for (const row of history.rows) {
      if (row.scaleMissing) continue;
      const credit = BigInt(row.accAmountCNS || "0");
      const forfeited = forfeitCNS((credit * 100_000n) / split.userPer100K, split);
      paid += forfeited;
      if (row.eligible) avoidable += forfeited;
    }
    expect(avoidable).toBeLessThan(paid);
    if (process.env.WRITE_FIXTURE === "1") {
      const sample = history.latest.slice(0, 5).map((row) => {
        const perp = byPerp.get(row.perpId);
        return {
          blockNumber: row.blockNumber,
          perpId: row.perpId,
          positionType: row.positionType,
          markPricePNS: row.markPricePNS,
          liqLotLNS: row.liqLotLNS,
          posDepositCNS: row.posDepositCNS,
          accAmountCNS: row.accAmountCNS,
          accBalanceCNS: String(BigInt(row.idleAtLiq) + (BigInt(row.accAmountCNS) > 0n ? BigInt(row.accAmountCNS) : 0n)),
          priceDecimals: perp?.priceDecimals ?? 0,
          lotDecimals: perp?.lotDecimals ?? 0,
          symbol: row.symbol,
          side: row.side,
        };
      });
      writeFileSync(new URL("./fixtures/v1-liquidations.json", import.meta.url), `${JSON.stringify(sample, null, 2)}\n`);
    }
  }, 30_000);
});
