import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ADDRESSES,
  GAS_LIMITS,
  ORDER_CANCEL,
  ORDER_CLOSE_LONG,
  ORDER_CLOSE_SHORT,
  ORDER_OPEN_LONG,
  ORDER_OPEN_SHORT,
  TESTNET_ID,
  assignOperatorTypes,
  ausdTransferTx,
  bookPricePNS,
  createAccountTx,
  delegatedAccountAbi,
  delegatedAccountFactoryAbi,
  erc20Abi,
  exchangeAbi,
  execOrderTx,
  factoryCreateTx,
  factoryDomain,
  functionSelector,
  iocOpenTx,
  listPerps,
  MICRO,
  orderDesc,
  priceToMicro,
  postOnlyMakerTx,
  restingAskPricePNS,
  revokeOperatorAllowlistTxs,
  type OrderDesc,
} from "@lifeline/core";
import { decodeEventLog, type Address, type Hex, type PublicClient } from "viem";
import { workspaceRoot } from "./keys-generate.js";
import { SPONSOR_FLOOR, WEI } from "../funding.js";
import { loadRoles } from "../roles.js";
import { testnetPublicClient, testnetWallet } from "../testnet.js";

const POOL_AUSD = 400n * 1_000_000n;

export type TwinSide = "long" | "short";

export interface TwinLeg {
  proxy: Address | null;
}

export interface TwinPair {
  id: string;
  market: string;
  side: TwinSide;
  perpId: string;
  leverageHdths: string;
  protected: TwinLeg;
  unprotected: TwinLeg;
}

interface TwinsFile {
  solFallback: string | null;
  pairs: TwinPair[];
}

interface Book {
  markPNS: bigint;
  basePricePNS: bigint;
  maxBidPriceONS: bigint;
  minAskPriceONS: bigint;
  priceDecimals: number;
  lotDecimals: number;
}

export interface TwinSpec {
  id: string;
  market: string;
  side: TwinSide;
  cap: bigint;
}

const PLAN: TwinSpec[] = [
  { id: "btc-long", market: "BTC", side: "long", cap: 1500n },
  { id: "btc-short", market: "BTC", side: "short", cap: 1500n },
  { id: "sol-long", market: "SOL", side: "long", cap: 1000n },
  { id: "sol-short", market: "SOL", side: "short", cap: 1000n },
];

export function twinLeverage(capHdths: bigint, initHdths: bigint): bigint {
  if (initHdths <= 0n) return capHdths;
  return initHdths < capHdths ? initHdths : capHdths;
}

/** Size a leg so two of them fit in the maker's free balance and one fits in the 400 AUSD account. */
export function lotForLeverage(
  markPNS: bigint,
  priceDecimals: number,
  lotDecimals: number,
  leverageHdths: bigint,
  marginMicro = 180n * MICRO,
): bigint {
  if (leverageHdths <= 0n) return 1n;
  const notional = (marginMicro * leverageHdths) / 100n;
  const price = priceToMicro(markPNS, priceDecimals);
  if (price <= 0n || notional <= 0n) return 1n;
  const lot = (notional * 10n ** BigInt(lotDecimals)) / price;
  return lot > 0n ? lot : 1n;
}

/** Entry prices match when they differ by at most 0.1%. */
export function entriesMatch(left: bigint, right: bigint): boolean {
  if (left <= 0n || right <= 0n) return false;
  const diff = left > right ? left - right : right - left;
  const base = left > right ? left : right;
  return diff * 1000n <= base;
}

function twinsPath(root: string): string {
  return path.join(root, "cli-state", "twins.json");
}

function loadTwins(root: string): TwinsFile {
  try {
    const parsed = JSON.parse(readFileSync(twinsPath(root), "utf8")) as TwinsFile;
    return { solFallback: parsed.solFallback ?? null, pairs: parsed.pairs ?? [] };
  } catch {
    return { solFallback: null, pairs: [] };
  }
}

function saveTwins(root: string, state: TwinsFile) {
  const file = twinsPath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

function gasOf(name: string): bigint {
  const gas = GAS_LIMITS[name];
  if (gas === undefined) throw new Error(`missing gas limit ${name}`);
  return gas;
}

async function sendBuilt(
  client: PublicClient,
  wallet: ReturnType<typeof testnetWallet>,
  account: ReturnType<typeof loadRoles>["POOL_OWNER"],
  built: { to: Address; data: Hex; gas: bigint; value: bigint },
  kind: string,
) {
  const hash = await wallet.sendTransaction({
    account,
    chain: wallet.chain,
    to: built.to,
    data: built.data,
    gas: built.gas,
    value: built.value,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const status = receipt.status === "success" ? 1 : 0;
  console.log(`${kind} tx ${hash} status=${status} gas=${receipt.gasUsed}`);
  if (status !== 1) throw new Error(`${kind} reverted ${hash}`);
  return receipt;
}

function proxyFromReceipt(receipt: { logs: readonly { data: Hex; topics: readonly Hex[] }[] }): Address {
  for (const log of receipt.logs) {
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
  throw new Error("DelegatedAccountCreated missing");
}

async function topUp(
  client: PublicClient,
  sponsor: ReturnType<typeof loadRoles>["SPONSOR"],
  wallet: ReturnType<typeof testnetWallet>,
  to: Address,
  target: bigint,
  label: string,
) {
  const have = await client.getBalance({ address: to });
  if (have >= target) return;
  const need = target - have;
  const sponsorBal = await client.getBalance({ address: sponsor.address });
  const gas = gasOf("monDrip");
  const fees = await client.estimateFeesPerGas();
  const cost = gas * (fees.maxFeePerGas ?? 0n);
  const room = sponsorBal > SPONSOR_FLOOR + cost ? sponsorBal - SPONSOR_FLOOR - cost : 0n;
  if (room < need) {
    if (room <= 0n) {
      console.log(`topup ${label} skipped; sponsor would breach 3 MON`);
      return;
    }
    console.log(`topup ${label} partial ${room} wei`);
  }
  const value = room < need ? room : need;
  const hash = await wallet.sendTransaction({
    account: sponsor,
    chain: wallet.chain,
    to,
    value,
    gas,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const status = receipt.status === "success" ? 1 : 0;
  console.log(`topup ${label} +${value} wei tx ${hash} status=${status} gas=${receipt.gasUsed}`);
  if (status !== 1) throw new Error(`topup ${label} reverted`);
}

export async function twinsCreate(root = workspaceRoot(), extra: readonly TwinSpec[] = []): Promise<number> {
  const plan = [...PLAN, ...extra];
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
  const sponsor = roles.SPONSOR;
  const ownerWallet = testnetWallet(owner);
  const makerWallet = testnetWallet(maker);
  const sponsorWallet = testnetWallet(sponsor);

  const state = loadTwins(root);
  const plannedIds = new Set(plan.map((spec) => spec.id));
  const kept = [];
  for (const pair of state.pairs) {
    if (plannedIds.has(pair.id)) {
      kept.push(pair);
      continue;
    }
    const perpId = BigInt(pair.perpId);
    const left = await positionOf(client, exchange, pair.protected.proxy, perpId);
    const right = await positionOf(client, exchange, pair.unprotected.proxy, perpId);
    if (left && right && entriesMatch(left.pricePNS, right.pricePNS)) {
      kept.push(pair);
      continue;
    }
    if (left || right) {
      console.log(`close unmatched ${pair.id}`);
      const closing = {
        client,
        owner,
        ownerWallet,
        exchange,
        pair,
        leverage: BigInt(pair.leverageHdths || "300"),
      };
      for (const leg of [
        { proxy: pair.protected.proxy, position: left },
        { proxy: pair.unprotected.proxy, position: right },
      ]) {
        if (!leg.position) continue;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const still = await positionOf(client, exchange, leg.proxy, perpId);
          if (!still) break;
          await closeLeg(closing, leg.proxy, still.lotLNS, still.positionType);
        }
      }
    }
    const leftAfter = await positionOf(client, exchange, pair.protected.proxy, perpId);
    const rightAfter = await positionOf(client, exchange, pair.unprotected.proxy, perpId);
    if (!leftAfter && !rightAfter) console.log(`drop empty ${pair.id}`);
    else kept.push(pair);
  }
  state.pairs = kept;
  saveTwins(root, state);
  const perps = await listPerps(client, exchange);
  const bySymbol = new Map(perps.map((perp) => [perp.symbol.toUpperCase(), perp.perpId]));
  let failed = false;

  for (const spec of plan) {
    let market: string = spec.market;
    let perpId = bySymbol.get(market);
    if (market === "SOL" && (perpId === undefined || state.solFallback === "ETH")) {
      const eth = bySymbol.get("ETH");
      if (eth === undefined) {
        console.error("no SOL or ETH market");
        return 1;
      }
      if (state.solFallback !== "ETH") {
        console.log("twins SOL unavailable, using ETH");
        state.solFallback = "ETH";
        saveTwins(root, state);
      }
      market = "ETH";
      perpId = eth;
    }
    if (perpId === undefined) {
      console.error(`no ${market} market`);
      return 1;
    }
    let pair = state.pairs.find((item) => item.id === spec.id);
    if (!pair) {
      pair = {
        id: spec.id,
        market,
        side: spec.side,
        perpId: String(perpId),
        leverageHdths: "0",
        protected: { proxy: null },
        unprotected: { proxy: null },
      };
      state.pairs.push(pair);
      saveTwins(root, state);
    }
    const open = await positionOf(client, exchange, pair.protected.proxy, BigInt(pair.perpId));
    const other = await positionOf(client, exchange, pair.unprotected.proxy, BigInt(pair.perpId));
    if (open && other && entriesMatch(open.pricePNS, other.pricePNS)) {
      console.log(`${pair.id} already open ${open.pricePNS} ${other.pricePNS}`);
      continue;
    }
    await topUp(client, sponsor, sponsorWallet, owner.address, 5n * WEI, "pool owner");
    await topUp(client, sponsor, sponsorWallet, maker.address, (3n * WEI) / 2n, "maker");
    if (!pair.protected.proxy) {
      pair.protected.proxy = await provision(client, owner, ownerWallet, operator, factory);
      saveTwins(root, state);
    }
    if (!pair.unprotected.proxy) {
      pair.unprotected.proxy = await provision(client, owner, ownerWallet, operator, factory);
      saveTwins(root, state);
    }
    const book = await readBook(client, exchange, BigInt(pair.perpId));
    const leverage = twinLeverage(spec.cap, await initMargin(client, exchange, BigInt(pair.perpId), 1n));
    const lot = lotForLeverage(book.markPNS, book.priceDecimals, book.lotDecimals, leverage);
    pair.leverageHdths = leverage.toString();
    pair.market = market;
    saveTwins(root, state);
    const ok = await openPair({
      client,
      owner,
      ownerWallet,
      maker,
      makerWallet,
      exchange,
      ausd,
      pair,
      book,
      lot,
      leverage,
    });
    if (!ok) {
      if (spec.market === "SOL" && market === "SOL") {
        console.log(`twins ${pair.id} self-match failed, falling back to ETH`);
        state.solFallback = "ETH";
        saveTwins(root, state);
        failed = true;
      } else {
        console.error(`twins ${pair.id} failed`);
        failed = true;
      }
    }
  }

  if (state.solFallback === "ETH") {
    for (const spec of plan.filter((item) => item.market === "SOL")) {
      const pair = state.pairs.find((item) => item.id === spec.id);
      const eth = bySymbol.get("ETH");
      if (!pair || eth === undefined) continue;
      const legsOpen = await bothOpen(client, exchange, pair);
      if (legsOpen) continue;
      pair.market = "ETH";
      pair.perpId = String(eth);
      saveTwins(root, state);
      const book = await readBook(client, exchange, BigInt(eth));
      const leverage = twinLeverage(1200n, await initMargin(client, exchange, BigInt(eth), 1n));
      const lot = lotForLeverage(book.markPNS, book.priceDecimals, book.lotDecimals, leverage);
      pair.leverageHdths = leverage.toString();
      const ok = await openPair({
        client,
        owner,
        ownerWallet,
        maker,
        makerWallet,
        exchange,
        ausd,
        pair,
        book,
        lot,
        leverage,
      });
      if (!ok) failed = true;
    }
  }

  for (const pair of state.pairs) {
    const protectedPos = await positionOf(client, exchange, pair.protected.proxy, BigInt(pair.perpId));
    const unprotectedPos = await positionOf(client, exchange, pair.unprotected.proxy, BigInt(pair.perpId));
    if (!protectedPos || !unprotectedPos || !pair.protected.proxy || !pair.unprotected.proxy) {
      console.error(`${pair.id} missing a position`);
      failed = true;
      continue;
    }
    const match = entriesMatch(protectedPos.pricePNS, unprotectedPos.pricePNS);
    const ownerOk = await owns(client, pair.protected.proxy, owner.address) && await owns(client, pair.unprotected.proxy, owner.address);
    const operatorOk =
      (await isOperator(client, pair.protected.proxy, operator.address)) &&
      (await isOperator(client, pair.unprotected.proxy, operator.address));
    console.log(
      `${pair.id} ${pair.market} ${pair.side} entry ${protectedPos.pricePNS} ${unprotectedPos.pricePNS} match=${match} ownerOk=${ownerOk} operatorOk=${operatorOk} protected=${pair.protected.proxy} unprotected=${pair.unprotected.proxy}`,
    );
    if (!match || !ownerOk || !operatorOk) failed = true;
  }
  console.log(`twins pairs=${state.pairs.length} solFallback=${state.solFallback ?? "none"}`);
  return failed || state.pairs.length < plan.length ? 1 : 0;
}

async function bothOpen(client: PublicClient, exchange: Address, pair: TwinPair): Promise<boolean> {
  const left = await positionOf(client, exchange, pair.protected.proxy, BigInt(pair.perpId));
  const right = await positionOf(client, exchange, pair.unprotected.proxy, BigInt(pair.perpId));
  return Boolean(left && right);
}

async function provision(
  client: PublicClient,
  owner: ReturnType<typeof loadRoles>["POOL_OWNER"],
  ownerWallet: ReturnType<typeof testnetWallet>,
  operator: ReturnType<typeof loadRoles>["OPERATOR"],
  factory: Address,
): Promise<Address> {
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
  const receipt = await sendBuilt(
    client,
    ownerWallet,
    owner,
    factoryCreateTx(factory, operator.address, deadline, signature),
    "factory.create",
  );
  const proxy = proxyFromReceipt(receipt);
  console.log(`created ${proxy}`);
  return proxy;
}

async function openPair(args: {
  client: PublicClient;
  owner: ReturnType<typeof loadRoles>["POOL_OWNER"];
  ownerWallet: ReturnType<typeof testnetWallet>;
  maker: ReturnType<typeof loadRoles>["MAKER"];
  makerWallet: ReturnType<typeof testnetWallet>;
  exchange: Address;
  ausd: Address;
  pair: TwinPair;
  book: Book;
  lot: bigint;
  leverage: bigint;
}): Promise<boolean> {
  const proxies = [args.pair.protected.proxy, args.pair.unprotected.proxy];
  for (const proxy of proxies) {
    if (!proxy) return false;
    await fundAccount(args.client, args.ownerWallet, args.owner, args.ausd, proxy);
    await revokeAllowlist(args.client, args.ownerWallet, args.owner, proxy);
  }
  const perpId = BigInt(args.pair.perpId);
  const left = await positionOf(args.client, args.exchange, args.pair.protected.proxy, perpId);
  const right = await positionOf(args.client, args.exchange, args.pair.unprotected.proxy, perpId);
  if (left && right && entriesMatch(left.pricePNS, right.pricePNS)) return true;
  if (left && right) {
    console.log(`${args.pair.id} entries ${left.pricePNS} ${right.pricePNS} differ; closing`);
    for (const leg of [
      { proxy: args.pair.protected.proxy, lot: left.lotLNS, positionType: left.positionType },
      { proxy: args.pair.unprotected.proxy, lot: right.lotLNS, positionType: right.positionType },
    ]) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const still = await positionOf(args.client, args.exchange, leg.proxy, perpId);
        if (!still) break;
        await closeLeg(args, leg.proxy, still.lotLNS, still.positionType);
      }
    }
  }
  const bookFilled = !left && !right && (await tryBook(args, args.lot));
  if (bookFilled) return true;
  return selfMatch(args, args.lot);
}

async function tryBook(
  args: {
    client: PublicClient;
    owner: ReturnType<typeof loadRoles>["POOL_OWNER"];
    ownerWallet: ReturnType<typeof testnetWallet>;
    exchange: Address;
    pair: TwinPair;
    book: Book;
    leverage: bigint;
  },
  lot: bigint,
): Promise<boolean> {
  const ons = args.pair.side === "long" ? args.book.minAskPriceONS : args.book.maxBidPriceONS;
  if (ons === 0n) {
    console.log(`${args.pair.id} book empty`);
    return false;
  }
  const price = bookPricePNS(args.book.basePricePNS, ons);
  const proxies = [args.pair.protected.proxy, args.pair.unprotected.proxy];
  for (const proxy of proxies) {
    if (!proxy) return false;
    const existing = await positionOf(args.client, args.exchange, proxy, BigInt(args.pair.perpId));
    if (existing) continue;
    try {
      await sendBuilt(
        args.client,
        args.ownerWallet,
        args.owner,
        iocOpenTx(proxy, openOrder(args.pair, price, lot, args.leverage)),
        `${args.pair.id}.book`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : "reverted";
      console.log(`${args.pair.id} book ${message?.slice(0, 140)}`);
      return false;
    }
  }
  const left = await positionOf(args.client, args.exchange, args.pair.protected.proxy, BigInt(args.pair.perpId));
  const right = await positionOf(args.client, args.exchange, args.pair.unprotected.proxy, BigInt(args.pair.perpId));
  const ok = Boolean(left && right && entriesMatch(left.pricePNS, right.pricePNS));
  console.log(`${args.pair.id} book ok=${ok}`);
  return ok;
}

async function selfMatch(
  args: {
    client: PublicClient;
    owner: ReturnType<typeof loadRoles>["POOL_OWNER"];
    ownerWallet: ReturnType<typeof testnetWallet>;
    maker: ReturnType<typeof loadRoles>["MAKER"];
    makerWallet: ReturnType<typeof testnetWallet>;
    exchange: Address;
    pair: TwinPair;
    leverage: bigint;
  },
  lot: bigint,
): Promise<boolean> {
  const perpId = BigInt(args.pair.perpId);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const book = await readBook(args.client, args.exchange, perpId);
    await cancelMaker(args.client, args.makerWallet, args.maker, args.exchange, perpId);
    const makerSide: TwinSide = args.pair.side === "long" ? "short" : "long";
    const price = makerSide === "short" ? restingAskPricePNS(book) : restingBid(book);
    const missing: Address[] = [];
    for (const proxy of [args.pair.protected.proxy, args.pair.unprotected.proxy]) {
      if (!proxy) return false;
      const position = await positionOf(args.client, args.exchange, proxy, perpId);
      if (!position) missing.push(proxy);
    }
    if (missing.length === 0) {
      const filledLeft = await positionOf(args.client, args.exchange, args.pair.protected.proxy, perpId);
      const filledRight = await positionOf(args.client, args.exchange, args.pair.unprotected.proxy, perpId);
      return Boolean(filledLeft && filledRight && entriesMatch(filledLeft.pricePNS, filledRight.pricePNS));
    }
    console.log(`${args.pair.id} self-match attempt ${attempt} price=${price} legs=${missing.length}`);
    try {
      await sendBuilt(
        args.client,
        args.makerWallet,
        args.maker,
        postOnlyMakerTx(
          args.exchange,
          orderDesc({
            perpId,
            orderType: makerSide === "long" ? ORDER_OPEN_LONG : ORDER_OPEN_SHORT,
            pricePNS: price,
            lotLNS: lot * BigInt(missing.length),
            leverageHdths: args.leverage,
            postOnly: true,
          }),
        ),
        `${args.pair.id}.maker`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : "reverted";
      console.log(`${args.pair.id} maker ${message?.slice(0, 160)}`);
      continue;
    }
    for (const proxy of missing) {
      try {
        await sendBuilt(
          args.client,
          args.ownerWallet,
          args.owner,
          iocOpenTx(proxy, openOrder(args.pair, price, lot, args.leverage)),
          `${args.pair.id}.ioc`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message.split("\n")[0] : "reverted";
        console.log(`${args.pair.id} ioc ${message?.slice(0, 140)}`);
      }
    }
    const left = await positionOf(args.client, args.exchange, args.pair.protected.proxy, perpId);
    const right = await positionOf(args.client, args.exchange, args.pair.unprotected.proxy, perpId);
    if (left && right && entriesMatch(left.pricePNS, right.pricePNS)) return true;
  }
  return false;
}

async function closeLeg(
  args: {
    client: PublicClient;
    owner: ReturnType<typeof loadRoles>["POOL_OWNER"];
    ownerWallet: ReturnType<typeof testnetWallet>;
    exchange: Address;
    pair: TwinPair;
    leverage: bigint;
  },
  proxy: Address | null,
  lot: bigint,
  positionType: number,
) {
  if (!proxy || lot <= 0n) return;
  const book = await readBook(args.client, args.exchange, BigInt(args.pair.perpId));
  const short = positionType === 1;
  const price = crossingClosePrice(book, short);
  try {
    await sendBuilt(
      args.client,
      args.ownerWallet,
      args.owner,
      iocOpenTx(
        proxy,
        orderDesc({
          perpId: BigInt(args.pair.perpId),
          orderType: short ? ORDER_CLOSE_SHORT : ORDER_CLOSE_LONG,
          pricePNS: price,
          lotLNS: lot,
          leverageHdths: args.leverage,
          immediateOrCancel: true,
          maxMatches: 50n,
        }),
      ),
      `${args.pair.id}.close`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "reverted";
    console.log(`${args.pair.id} close ${message?.slice(0, 160)}`);
  }
}

function openOrder(pair: TwinPair, price: bigint, lot: bigint, leverage: bigint): OrderDesc {
  return orderDesc({
    perpId: BigInt(pair.perpId),
    orderType: pair.side === "long" ? ORDER_OPEN_LONG : ORDER_OPEN_SHORT,
    pricePNS: price,
    lotLNS: lot,
    leverageHdths: leverage,
    immediateOrCancel: true,
    maxMatches: 1n,
  });
}

function crossingClosePrice(book: Book, short: boolean): bigint {
  if (short) {
    const ask = book.minAskPriceONS === 0n ? 0n : bookPricePNS(book.basePricePNS, book.minAskPriceONS);
    const cap = (book.markPNS * 10_300n) / 10_000n;
    return ask > cap ? ask : cap;
  }
  const bid = book.maxBidPriceONS === 0n ? 0n : bookPricePNS(book.basePricePNS, book.maxBidPriceONS);
  const floor = (book.markPNS * 9_700n) / 10_000n;
  if (bid === 0n) return floor > 0n ? floor : book.markPNS;
  return bid < floor ? bid : floor;
}

function restingBid(book: Book): bigint {
  const bestBid = book.maxBidPriceONS === 0n ? 0n : bookPricePNS(book.basePricePNS, book.maxBidPriceONS);
  const bestAsk = book.minAskPriceONS === 0n ? 0n : bookPricePNS(book.basePricePNS, book.minAskPriceONS);
  let price = (book.markPNS * 9_995n) / 10_000n;
  const lower = bestBid === 0n ? 0n : bestBid + 1n;
  const upper = bestAsk === 0n ? 0n : bestAsk - 1n;
  if (upper > lower) {
    if (price < lower) price = lower;
    if (price > upper) price = upper;
    return price;
  }
  if (bestBid !== 0n) return bestBid;
  if (bestAsk !== 0n && price >= bestAsk) return bestAsk - 1n;
  return price > 0n ? price : book.markPNS;
}

async function fundAccount(
  client: PublicClient,
  wallet: ReturnType<typeof testnetWallet>,
  owner: ReturnType<typeof loadRoles>["POOL_OWNER"],
  ausd: Address,
  proxy: Address,
) {
  const accountId = (await client.readContract({
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "accountId",
  })) as bigint;
  if (accountId !== 0n) return;
  const balance = (await client.readContract({
    address: ausd,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [proxy],
  })) as bigint;
  if (balance < POOL_AUSD) {
    await sendBuilt(client, wallet, owner, ausdTransferTx(ausd, proxy, POOL_AUSD), "ausd.transfer");
  }
  await sendBuilt(client, wallet, owner, createAccountTx(proxy, POOL_AUSD), "createAccount");
}

async function revokeAllowlist(
  client: PublicClient,
  wallet: ReturnType<typeof testnetWallet>,
  owner: ReturnType<typeof loadRoles>["POOL_OWNER"],
  proxy: Address,
) {
  const names = [
    "execOrder",
    "execOrders",
    "requestDecreasePositionCollateral",
    "buyLiquidations",
    "depositCollateral",
    "allowOrderForwarding",
  ] as const;
  const txs = revokeOperatorAllowlistTxs(proxy);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const built = txs[index];
    if (!name || !built) continue;
    const allowed = (await client.readContract({
      address: proxy,
      abi: delegatedAccountAbi,
      functionName: "operatorAllowlist",
      args: [functionSelector(name)],
    })) as boolean;
    if (!allowed) continue;
    await sendBuilt(client, wallet, owner, built, `allowlist.${name}`);
  }
}

async function cancelMaker(
  client: PublicClient,
  wallet: ReturnType<typeof testnetWallet>,
  maker: ReturnType<typeof loadRoles>["MAKER"],
  exchange: Address,
  perpId: bigint,
) {
  const info = await accountOf(client, exchange, maker.address);
  if (!info) return;
  const locks = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPerpOrderLocks",
    args: [info, perpId],
  })) as readonly { orderLockId: number; lotLNS: bigint }[];
  for (const lock of locks) {
    const orderId = BigInt(lock.orderLockId);
    if (orderId === 0n) continue;
    await sendBuilt(
      client,
      wallet,
      maker,
      execOrderTx(
        exchange,
        orderDesc({
          perpId,
          orderType: ORDER_CANCEL,
          orderId,
          pricePNS: 1n,
          lotLNS: lock.lotLNS === 0n ? 1n : lock.lotLNS,
          leverageHdths: 1500n,
        }),
      ),
      "maker.cancel",
    );
  }
}

async function positionOf(client: PublicClient, exchange: Address, proxy: Address | null, perpId: bigint) {
  if (!proxy) return null;
  const accountId = (await client.readContract({
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "accountId",
  })) as bigint;
  if (accountId === 0n) return null;
  const result = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPositionV2",
    args: [perpId, accountId],
  })) as readonly [{ lotLNS: bigint; pricePNS: bigint; positionType: number }, bigint, boolean];
  if (result[0].lotLNS === 0n) return null;
  return result[0];
}

async function readBook(client: PublicClient, exchange: Address, perpId: bigint): Promise<Book> {
  const info = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPerpetualInfoV2",
    args: [perpId],
  })) as {
    priceDecimals: bigint;
    lotDecimals: bigint;
    markPNS: bigint;
    basePricePNS: bigint;
    maxBidPriceONS: bigint;
    minAskPriceONS: bigint;
  };
  return {
    priceDecimals: Number(info.priceDecimals),
    lotDecimals: Number(info.lotDecimals),
    markPNS: info.markPNS,
    basePricePNS: info.basePricePNS,
    maxBidPriceONS: info.maxBidPriceONS,
    minAskPriceONS: info.minAskPriceONS,
  };
}

async function initMargin(client: PublicClient, exchange: Address, perpId: bigint, lot: bigint): Promise<bigint> {
  const raw = await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getMarginFractions",
    args: [perpId, lot],
  });
  if (Array.isArray(raw)) return raw[0] as bigint;
  return (raw as { perpInitMarginFracHdths: bigint }).perpInitMarginFracHdths;
}

async function accountOf(client: PublicClient, exchange: Address, account: Address): Promise<bigint | null> {
  try {
    const info = (await client.readContract({
      address: exchange,
      abi: exchangeAbi,
      functionName: "getAccountByAddr",
      args: [account],
    })) as { accountId: bigint };
    return info.accountId;
  } catch {
    return null;
  }
}

async function owns(client: PublicClient, proxy: Address, owner: Address): Promise<boolean> {
  const current = (await client.readContract({
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "owner",
  })) as Address;
  return current.toLowerCase() === owner.toLowerCase();
}

async function isOperator(client: PublicClient, proxy: Address, operator: Address): Promise<boolean> {
  return (await client.readContract({
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "isOperator",
    args: [operator],
  })) as boolean;
}
