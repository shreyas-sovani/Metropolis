import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  ADDRESSES,
  CHAINS,
  exchangeAbi,
  readExchangeSnapshot,
  rpcUrls,
  type ChainId,
  type PositionNode,
} from "@lifeline/core";
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  fallback,
  getAddress,
  http,
  type Address,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import {
  assertForkUrl,
  contractLiqPNS,
  coverageGaps,
  matchPct,
  type ChainCounts,
} from "../fork-truth.js";
import { workspaceRoot } from "./keys-generate.js";

const CALLER: Address = "0x000000000000000000000000000000000000bEEF";
const BALANCE = "0x3635C9ADC5DEA00000";
const TX_GAS = 30_000_000n;

export interface TruthPosition {
  accountId: string;
  perpId: string;
  positionType: number;
  pricePNS: string;
  priceResiduePNSQ16: string;
  lotLNS: string;
  depositCNS: string;
  premiumPnlCNS: string;
  priceDecimals: number;
  lotDecimals: number;
  maintHdths: string;
  liqPricePNS: string;
}

interface ChainReport extends ChainCounts {
  blockNumber: string;
  positionsRows: TruthPosition[];
}

export async function gate4Fork(
  root = workspaceRoot(),
  chains: readonly ChainId[] = [],
): Promise<number> {
  if (!resolveAnvil()) {
    console.error(`=== HUMAN STEP REQUIRED: U2 Install Foundry ===
Why this is needed: gate:4 --fork starts a local anvil fork. The command loads no role keys.
Please do:
  1. Run: curl -L https://foundry.paradigm.xyz | bash && foundryup
  2. Open a new shell so anvil is on PATH
Put secrets here (do NOT paste private keys into chat): none
Reply with: done
I will verify by: anvil --version, then pnpm cli gate:4 --fork`);
    return 1;
  }
  const reports: ChainReport[] = [];
  for (const chainId of chains) {
    console.error(`fork chain ${chainId}`);
    try {
      reports.push(await calibrateChain(chainId, root));
    } catch (error) {
      console.error(error instanceof Error ? error.message : "fork failed");
      return 1;
    }
  }
  const summary = {
    date: new Date().toISOString().slice(0, 10),
    positions: reports.reduce((sum, chain) => sum + chain.positions, 0),
    markets: reports.reduce((sum, chain) => sum + chain.markets, 0),
    shorts: reports.reduce((sum, chain) => sum + chain.shorts, 0),
    withPremium: reports.reduce((sum, chain) => sum + chain.withPremium, 0),
    withResidue: reports.reduce((sum, chain) => sum + chain.withResidue, 0),
    exactMatchPct: matchPct(
      reports.reduce((sum, chain) => sum + chain.exact, 0),
      reports.reduce((sum, chain) => sum + chain.positions, 0),
    ),
    chains: reports.map(({ positionsRows: _rows, ...chain }) => ({
      ...chain,
      exactMatchPct: matchPct(chain.exact, chain.positions),
    })),
  };
  writeFileSync(summaryPath(root), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary));
  if (chains.length === 2) {
    const gaps = coverageGaps(reports);
    if (gaps.length > 0) {
      console.error(gaps.join("\n"));
      return 1;
    }
  }
  return 0;
}

async function calibrateChain(chainId: ChainId, root: string): Promise<ChainReport> {
  const exchange = ADDRESSES[chainId].exchange;
  const owner = await ownerOnReal(chainId, exchange);
  const ownerNonce = await ownerNonceOnReal(chainId, owner);
  const callerNonce = await ownerNonceOnReal(chainId, CALLER);
  const urls = rpcUrls(chainId);
  let report: ChainReport | undefined;
  let last = "no rpc";
  for (const rpc of urls) {
    let child: ChildProcess | undefined;
    try {
      const started = await startAnvil(rpc);
      child = started.child;
      report = await readFork(started.url, chainId, exchange);
      writeFixture(root, chainId, report);
      console.error(
        `chain ${chainId} block ${report.blockNumber} positions ${report.positions} exact ${report.exact} markets ${report.markets}`,
      );
      break;
    } catch (error) {
      report = undefined;
      last = error instanceof Error ? error.message : "fork failed";
      console.error(`fork ${chainId} via ${rpc} failed: ${last}`);
    } finally {
      await stopAnvil(child);
    }
    await assertRealNonceUnchanged(chainId, owner, ownerNonce);
    await assertRealNonceUnchanged(chainId, CALLER, callerNonce);
  }
  await assertRealNonceUnchanged(chainId, owner, ownerNonce);
  await assertRealNonceUnchanged(chainId, CALLER, callerNonce);
  if (!report) throw new Error(`chain ${chainId} fork failed: ${last}`);
  console.error(`real nonce unchanged owner=${ownerNonce} caller=${callerNonce}`);
  return report;
}

async function readFork(url: string, chainId: ChainId, exchange: Address): Promise<ChainReport> {
  assertForkUrl(url);
  const local = createPublicClient({
    chain: CHAINS[chainId],
    transport: http(url, { timeout: 180_000, retryCount: 0 }),
  });
  const seen = await local.getChainId();
  if (seen !== chainId) throw new Error(`fork chain id ${seen} !== ${chainId}`);
  const owner = getAddress(
    (await local.readContract({ address: exchange, abi: exchangeAbi, functionName: "owner" })) as Address,
  );
  const head = await local.getBlock({ blockTag: "latest" });
  let timestamp = BigInt(head.timestamp) + 1n;
  await forkRequest(local, url, "anvil_setBalance", [CALLER, BALANCE]);
  await forkRequest(local, url, "anvil_setBalance", [owner, BALANCE]);
  await forkRequest(local, url, "anvil_impersonateAccount", [CALLER]);
  await forkRequest(local, url, "anvil_impersonateAccount", [owner]);
  for (const name of ["setPositionAdministrator", "setAdministrator"] as const) {
    const receipt = await mined(local, url, owner, exchange, name, [CALLER, true], () => {
      const next = timestamp;
      timestamp += 1n;
      return next;
    });
    if (receipt.status !== "success") throw new Error(`${name} status ${receipt.status}`);
  }
  const adminAbi = exchangeAbi;
  const positionAdmin = (await local.readContract({
    address: exchange,
    abi: adminAbi,
    functionName: "isPositionAdministrator",
    args: [CALLER],
  })) as boolean;
  const admin = (await local.readContract({
    address: exchange,
    abi: adminAbi,
    functionName: "isAdministrator",
    args: [CALLER],
  })) as boolean;
  if (!positionAdmin || !admin) throw new Error("fork caller was not granted liquidation rights");

  const markets = await readExchangeSnapshot(local, exchange);
  const rows: TruthPosition[] = [];
  const seenMarkets = new Set<number>();
  for (const market of markets) {
    const live = market.positions.filter((position) => position.lotLNS > 0n);
    if (live.length === 0) continue;
    const fractions = await local.readContract({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getMarginFractions",
      args: [BigInt(market.info.perpId), 0n],
    });
    const maintHdths = marginHdths(fractions);
    if (maintHdths === undefined || maintHdths <= 0n) {
      throw new Error(`perp ${market.info.perpId} maintenance hundredths missing`);
    }
    const truth = await liquidateMarket(local, url, exchange, BigInt(market.info.perpId), live, () => {
      const next = timestamp;
      timestamp += 1n;
      return next;
    });
    let kept = 0;
    for (const position of live) {
      const liq = truth.get(position.accountId.toString());
      if (liq === undefined) continue;
      const row: TruthPosition = {
        accountId: position.accountId.toString(),
        perpId: market.info.perpId.toString(),
        positionType: position.positionType,
        pricePNS: position.pricePNS.toString(),
        priceResiduePNSQ16: position.priceResiduePNSQ16.toString(),
        lotLNS: position.lotLNS.toString(),
        depositCNS: position.depositCNS.toString(),
        premiumPnlCNS: position.premiumPnlCNS.toString(),
        priceDecimals: market.info.priceDecimals,
        lotDecimals: market.info.lotDecimals,
        maintHdths: maintHdths.toString(),
        liqPricePNS: liq.toString(),
      };
      rows.push(row);
      kept += 1;
    }
    if (kept > 0) seenMarkets.add(market.info.perpId);
    console.error(`perp ${market.info.perpId} ${market.info.symbol} live ${live.length} truth ${kept}`);
  }
  rows.sort((left, right) => {
    const perp = Number(left.perpId) - Number(right.perpId);
    if (perp !== 0) return perp;
    return Number(left.accountId) - Number(right.accountId);
  });
  let shorts = 0;
  let withPremium = 0;
  let withResidue = 0;
  let exact = 0;
  let printed = 0;
  for (const row of rows) {
    if (row.positionType === 1) shorts += 1;
    if (BigInt(row.premiumPnlCNS) !== 0n) withPremium += 1;
    if (BigInt(row.priceResiduePNSQ16) !== 0n) withResidue += 1;
    const predicted = contractLiqPNS({
      positionType: row.positionType,
      pricePNS: BigInt(row.pricePNS),
      lotLNS: BigInt(row.lotLNS),
      depositCNS: BigInt(row.depositCNS),
      premiumPnlCNS: BigInt(row.premiumPnlCNS),
      priceDecimals: row.priceDecimals,
      lotDecimals: row.lotDecimals,
      maintHdths: BigInt(row.maintHdths),
    });
    if (predicted === BigInt(row.liqPricePNS)) exact += 1;
    else if (printed < 5) {
      printed += 1;
      console.error(
        `mismatch perp ${row.perpId} account ${row.accountId} predicted ${predicted} contract ${row.liqPricePNS}`,
      );
    }
  }
  return {
    chainId,
    blockNumber: head.number.toString(),
    positions: rows.length,
    markets: seenMarkets.size,
    shorts,
    withPremium,
    withResidue,
    exact,
    positionsRows: rows,
  };
}

async function ownerOnReal(chainId: ChainId, exchange: Address): Promise<Address> {
  const real = createPublicClient({
    chain: CHAINS[chainId],
    transport: fallback(rpcUrls(chainId).map((url) => http(url, { timeout: 20_000, retryCount: 1 }))),
  });
  return getAddress(
    (await real.readContract({
      address: exchange,
      abi: exchangeAbi,
      functionName: "owner",
    })) as Address,
  );
}

async function ownerNonceOnReal(chainId: ChainId, owner: Address): Promise<number> {
  const real = createPublicClient({
    chain: CHAINS[chainId],
    transport: fallback(rpcUrls(chainId).map((url) => http(url, { timeout: 20_000, retryCount: 1 }))),
  });
  return real.getTransactionCount({ address: owner });
}

async function liquidateMarket(
  local: PublicClient,
  url: string,
  exchange: Address,
  perpId: bigint,
  positions: readonly PositionNode[],
  nextTimestamp: () => bigint,
): Promise<Map<string, bigint>> {
  const truth = new Map<string, bigint>();
  const queue = [positions];
  while (queue.length > 0) {
    const batch = queue.shift();
    if (!batch || batch.length === 0) continue;
    const receipt = await mined(
      local,
      url,
      CALLER,
      exchange,
      "liquidations",
      [
        batch.map((position) => ({
          perpId,
          posAccountId: position.accountId,
          lotLNS: position.lotLNS,
          userProceedsToPosition: false,
        })),
        false,
      ],
      nextTimestamp,
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "liquidate failed";
      console.error(`perp ${perpId} batch ${batch.length} ${message.slice(0, 180)}`);
      return null;
    });
    const decoded = receipt && receipt.status === "success" ? liquidationPrices(receipt) : new Map<string, bigint>();
    if (!receipt || receipt.status !== "success" || decoded.size === 0) {
      if (decoded.size === 0 && receipt?.status === "success") {
        console.error(`perp ${perpId} batch ${batch.length} returned no liquidation events`);
      }
      if (batch.length === 1) continue;
      const mid = Math.ceil(batch.length / 2);
      queue.unshift(batch.slice(0, mid), batch.slice(mid));
      continue;
    }
    for (const [accountId, liqPricePNS] of decoded) truth.set(accountId, liqPricePNS);
  }
  return truth;
}

function liquidationPrices(receipt: TransactionReceipt): Map<string, bigint> {
  const truth = new Map<string, bigint>();
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: exchangeAbi, data: log.data, topics: log.topics });
      if (decoded.eventName !== "CantLiquidatePosAboveMMR" && decoded.eventName !== "PositionLiquidated") {
        continue;
      }
      const args = decoded.args as { posAccountId?: bigint; liqPricePNS?: bigint };
      if (args.posAccountId === undefined || args.liqPricePNS === undefined) continue;
      truth.set(args.posAccountId.toString(), args.liqPricePNS);
    } catch {
      continue;
    }
  }
  return truth;
}

async function mined(
  local: PublicClient,
  url: string,
  from: Address,
  to: Address,
  functionName: "setPositionAdministrator" | "setAdministrator" | "liquidations",
  args: readonly unknown[],
  nextTimestamp: () => bigint,
): Promise<TransactionReceipt> {
  assertForkUrl(url);
  const data = encodeFunctionData({
    abi: exchangeAbi,
    functionName,
    args: args as never,
  });
  const hash = (await forkRequest(local, url, "eth_sendTransaction", [
    { from, to, data, gas: `0x${TX_GAS.toString(16)}` },
  ])) as `0x${string}`;
  const timestamp = nextTimestamp();
  await forkRequest(local, url, "evm_mine", [`0x${timestamp.toString(16)}`]);
  return local.waitForTransactionReceipt({ hash, timeout: 180_000 });
}

async function forkRequest(
  local: PublicClient,
  url: string,
  method: string,
  params: readonly unknown[],
): Promise<unknown> {
  assertForkUrl(url);
  return local.request({ method: method as "eth_chainId", params: params as never });
}

function marginHdths(raw: unknown): bigint | undefined {
  if (Array.isArray(raw)) {
    const value = raw[1] as bigint | undefined;
    return typeof value === "bigint" ? value : undefined;
  }
  if (raw && typeof raw === "object" && "perpMaintMarginFracHdths" in raw) {
    const value = raw.perpMaintMarginFracHdths;
    return typeof value === "bigint" ? value : undefined;
  }
  return undefined;
}

function writeFixture(root: string, chainId: ChainId, report: ChainReport): void {
  const file = fixturePath(root, chainId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify(
      { chainId, blockNumber: report.blockNumber, positions: report.positionsRows },
      null,
      2,
    )}\n`,
  );
}

function fixturePath(root: string, chainId: ChainId): string {
  return path.join(root, "packages", "core", "test", "fixtures", `g4-truth-${chainId}.json`);
}

function summaryPath(root: string): string {
  return path.join(root, "packages", "core", "test", "fixtures", "g4-fork-summary.json");
}

function resolveAnvil(): string | null {
  const bundled = path.join(homedir(), ".foundry", "bin", "anvil");
  if (existsSync(bundled)) return bundled;
  return null;
}

async function startAnvil(forkUrl: string): Promise<{ url: string; child: ChildProcess }> {
  const bin = resolveAnvil();
  if (!bin) throw new Error("anvil missing");
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  assertForkUrl(url);
  const child = spawn(
    bin,
    [
      "--fork-url",
      forkUrl,
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--no-mining",
      "--quiet",
      "--disable-block-gas-limit",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  const keep = (chunk: Buffer) => {
    log = `${log}${chunk.toString()}`.slice(-4_000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  const ready = Date.now() + 90_000;
  while (Date.now() < ready) {
    if (child.exitCode !== null) throw new Error(`anvil exited ${child.exitCode} ${log}`);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return { url, child };
    } catch {
      await sleep(250);
    }
  }
  child.kill("SIGTERM");
  throw new Error(`anvil not ready ${log}`);
}

async function stopAnvil(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const done = Date.now() + 5_000;
  while (child.exitCode === null && Date.now() < done) await sleep(100);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no free port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The real-RPC nonce guard used to live beside the fork. Exported so a failed fork still checks it. */
export async function assertRealNonceUnchanged(
  chainId: ChainId,
  owner: Address,
  before: number,
): Promise<void> {
  const after = await ownerNonceOnReal(chainId, owner);
  if (after !== before) throw new Error(`owner nonce on the real rpc changed ${before} -> ${after}`);
}
