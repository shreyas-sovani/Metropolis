import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ADDRESSES,
  GAS_LIMITS,
  LOT_SCALE,
  ORDER_CANCEL,
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
  contractDistanceE6,
  listPerps,
  orderDesc,
  postOnlyMakerTx,
  priceToMicro,
  revokeOperatorAllowlistTxs,
  restingAskPricePNS,
  type OrderDesc,
} from "@lifeline/core";
import {
  decodeEventLog,
  encodeFunctionData,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { workspaceRoot } from "./keys-generate.js";
import { SPONSOR_FLOOR, WEI } from "../funding.js";
import { loadRoles } from "../roles.js";
import { testnetPublicClient, testnetWallet } from "../testnet.js";

const POOL_AUSD = 400n * 1_000_000n;
const MIN_FREE_AUSD = 250n * 1_000_000n;
const TARGET_NOTIONAL = 1_500n * 1_000_000n;

export type PoolMarket = "BTC" | "ETH";
export type PoolSide = "long" | "short";

export interface PoolAccount {
  proxy: Address;
  market: PoolMarket;
  side: PoolSide;
  perpId: string;
}

interface PoolFile {
  accounts: PoolAccount[];
}

interface Book {
  symbol: string;
  priceDecimals: number;
  lotDecimals: number;
  markPNS: bigint;
  basePricePNS: bigint;
  maxBidPriceONS: bigint;
  minAskPriceONS: bigint;
}

export function targetLeverageHdths(market: PoolMarket, initHdths: bigint): bigint {
  const cap = market === "BTC" ? 1500n : 1200n;
  if (initHdths <= 0n) return cap;
  return initHdths < cap ? initHdths : cap;
}

export function distanceBand(market: PoolMarket): { minE6: bigint; maxE6: bigint } {
  return market === "BTC"
    ? { minE6: 20_000n, maxE6: 35_000n }
    : { minE6: 25_000n, maxE6: 45_000n };
}

/** First account reduces an existing maker position. Later accounts alternate. */
export function accountSide(index: number, makerSide: PoolSide | "flat"): PoolSide {
  const first: PoolSide = makerSide === "short" ? "short" : "long";
  const opposite: PoolSide = first === "long" ? "short" : "long";
  return index % 2 === 0 ? first : opposite;
}

export function lotForNotional(markPNS: bigint, priceDecimals: number, lotDecimals: number): bigint {
  const price = priceToMicro(markPNS, priceDecimals);
  if (price <= 0n) return 1n;
  const lotScaled = (TARGET_NOTIONAL * LOT_SCALE) / price;
  const lot = (lotScaled * 10n ** BigInt(lotDecimals)) / LOT_SCALE;
  return lot > 0n ? lot : 1n;
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function poolPath(root: string): string {
  return path.join(root, "cli-state", "pool.json");
}

function loadPool(root: string): PoolFile {
  try {
    const parsed = JSON.parse(readFileSync(poolPath(root), "utf8")) as PoolFile;
    return { accounts: parsed.accounts ?? [] };
  } catch {
    return { accounts: [] };
  }
}

function savePool(root: string, state: PoolFile) {
  const file = poolPath(root);
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
  if (sponsorBal < SPONSOR_FLOOR + need + cost) {
    throw new Error(`sponsor cannot top up ${label} without breaching 3 MON`);
  }
  const hash = await wallet.sendTransaction({
    account: sponsor,
    chain: wallet.chain,
    to,
    value: need,
    gas,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const status = receipt.status === "success" ? 1 : 0;
  console.log(`topup ${label} +${need} wei tx ${hash} status=${status} gas=${receipt.gasUsed}`);
  if (status !== 1) throw new Error(`topup ${label} reverted`);
}

export async function poolCreate(root = workspaceRoot(), argv: readonly string[] = []): Promise<number> {
  const countRaw = option(argv, "--count");
  const marketRaw = option(argv, "--market");
  const count = Number(countRaw);
  const market = marketRaw?.toUpperCase();
  if (!Number.isInteger(count) || count < 1 || (market !== "BTC" && market !== "ETH")) {
    console.error("usage: pool:create --count N --market BTC|ETH");
    return 1;
  }

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

  const perps = await listPerps(client, exchange);
  const perp = perps.find((item) => item.symbol.toUpperCase() === market);
  if (!perp) {
    console.error(`no ${market} market on testnet`);
    return 1;
  }
  const perpId = BigInt(perp.perpId);
  const state = loadPool(root);
  const mine = () => state.accounts.filter((account) => account.market === market);

  const makerStart = await makerSide(client, exchange, maker.address, perpId);
  console.log(`pool:create market=${market} perp=${perpId} count=${count} have=${mine().length} maker=${makerStart}`);

  const needWork = mine().length < count || (await missingOpens(client, exchange, mine().slice(0, count)));
  if (!needWork) console.log("pool:create nothing new");
  if (needWork) {
    await topUp(client, sponsor, sponsorWallet, owner.address, (5n * WEI) / 2n, "pool owner");
    await topUp(client, sponsor, sponsorWallet, maker.address, WEI, "maker");
  }

  while (needWork && mine().length < count) {
    const side = accountSide(mine().length, makerStart);
    const proxy = await provisionAccount({
      client,
      owner,
      ownerWallet,
      operator,
      factory,
      ausd,
    });
    const account: PoolAccount = { proxy, market, side, perpId: perpId.toString() };
    state.accounts.push(account);
    savePool(root, state);
    console.log(`created ${proxy} side=${side}`);
  }

  for (const account of needWork ? mine() : []) {
    const book = await readBook(client, exchange, perpId);
    const opened = await ensureOpen({
      client,
      owner,
      ownerWallet,
      maker,
      makerWallet,
      exchange,
      ausd,
      account,
      book,
      market,
    });
    if (!opened) return 1;
    savePool(root, state);
  }

  if (mine().length > count) {
    console.log(`pool:create ${mine().length} ${market} accounts already recorded`);
  }

  let failed = false;
  for (const account of mine().slice(0, count)) {
    const ok = await checkAccount({
      client,
      exchange,
      account,
      owner: owner.address,
      operator: operator.address,
      market,
    });
    if (!ok) failed = true;
  }
  const makerNet = await makerLot(client, exchange, maker.address, perpId);
  const sample = mine()[0];
  const size = sample ? await positionLot(client, exchange, sample.proxy, perpId) : 1n;
  const flat = makerNet <= size && makerNet >= -size;
  console.log(`maker netLot=${makerNet} positionSize=${size} flat=${flat}`);
  if (!flat) failed = true;

  const complete = mine().filter((account) => account.proxy).length;
  console.log(`pool:create done ${Math.min(complete, count)}/${count}`);
  return failed ? 1 : 0;
}

async function missingOpens(client: PublicClient, exchange: Address, accounts: PoolAccount[]): Promise<boolean> {
  for (const account of accounts) {
    const accountId = (await client.readContract({
      address: account.proxy,
      abi: delegatedAccountAbi,
      functionName: "accountId",
    })) as bigint;
    if (accountId === 0n) return true;
    const position = await readPosition(client, exchange, BigInt(account.perpId), accountId);
    if (position.lotLNS === 0n) return true;
  }
  return false;
}

async function provisionAccount(args: {
  client: PublicClient;
  owner: ReturnType<typeof loadRoles>["POOL_OWNER"];
  ownerWallet: ReturnType<typeof testnetWallet>;
  operator: ReturnType<typeof loadRoles>["OPERATOR"];
  factory: Address;
  ausd: Address;
}): Promise<Address> {
  const nonce = (await args.client.readContract({
    address: args.factory,
    abi: delegatedAccountFactoryAbi,
    functionName: "operatorNonces",
    args: [args.operator.address],
  })) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await args.operator.signTypedData({
    domain: factoryDomain(args.factory, TESTNET_ID),
    types: assignOperatorTypes,
    primaryType: "AssignOperator",
    message: { owner: args.owner.address, nonce, deadline },
  });
  const receipt = await sendBuilt(
    args.client,
    args.ownerWallet,
    args.owner,
    factoryCreateTx(args.factory, args.operator.address, deadline, signature),
    "factory.create",
  );
  return proxyFromReceipt(receipt);
}

async function ensureOpen(args: {
  client: PublicClient;
  owner: ReturnType<typeof loadRoles>["POOL_OWNER"];
  ownerWallet: ReturnType<typeof testnetWallet>;
  maker: ReturnType<typeof loadRoles>["MAKER"];
  makerWallet: ReturnType<typeof testnetWallet>;
  exchange: Address;
  ausd: Address;
  account: PoolAccount;
  book: Book;
  market: PoolMarket;
}): Promise<boolean> {
  const { client, account } = args;
  const proxy = account.proxy;
  const perpId = BigInt(account.perpId);
  let accountId = (await client.readContract({
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "accountId",
  })) as bigint;
  if (accountId === 0n) {
    const ausdBal = (await client.readContract({
      address: args.ausd,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [proxy],
    })) as bigint;
    if (ausdBal < POOL_AUSD) {
      await sendBuilt(
        client,
        args.ownerWallet,
        args.owner,
        ausdTransferTx(args.ausd, proxy, POOL_AUSD),
        "ausd.transfer",
      );
    }
    await sendBuilt(
      client,
      args.ownerWallet,
      args.owner,
      createAccountTx(proxy, POOL_AUSD),
      "createAccount",
    );
    accountId = (await client.readContract({
      address: proxy,
      abi: delegatedAccountAbi,
      functionName: "accountId",
    })) as bigint;
  }
  await revokeAllowlist(client, args.ownerWallet, args.owner, proxy);
  const position = await readPosition(client, args.exchange, perpId, accountId);
  if (position.lotLNS > 0n) {
    console.log(`open ${proxy} lot=${position.lotLNS} already`);
    return true;
  }
  const lot = lotForNotional(args.book.markPNS, args.book.priceDecimals, args.book.lotDecimals);
  const leverage = await leverageFor(client, args.exchange, perpId, lot, args.market);
  console.log(`open ${proxy} side=${account.side} lot=${lot} leverageHdths=${leverage}`);
  const filledBook = await tryBook({
    client,
    owner: args.owner,
    ownerWallet: args.ownerWallet,
    exchange: args.exchange,
    proxy,
    perpId,
    accountId,
    book: args.book,
    side: account.side,
    lot,
    leverage,
    makerReduces: await reducesMaker(client, args.exchange, args.maker.address, perpId, account.side),
  });
  if (filledBook) return true;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const live = await readBook(client, args.exchange, perpId);
    await cancelMaker(client, args.makerWallet, args.maker, args.exchange, perpId);
    const makerSide: PoolSide = account.side === "long" ? "short" : "long";
    const price =
      makerSide === "short"
        ? restingAskPricePNS({
            markPNS: live.markPNS,
            basePricePNS: live.basePricePNS,
            maxBidPriceONS: live.maxBidPriceONS,
            minAskPriceONS: live.minAskPriceONS,
          })
        : restingBid(live);
    console.log(`self-match attempt ${attempt} ${account.side} price=${price}`);
    await sendBuilt(
      client,
      args.makerWallet,
      args.maker,
      postOnlyMakerTx(
        args.exchange,
        orderDesc({
          perpId,
          orderType: makerSide === "long" ? ORDER_OPEN_LONG : ORDER_OPEN_SHORT,
          pricePNS: price,
          lotLNS: lot,
          leverageHdths: leverage,
          postOnly: true,
        }),
      ),
      "maker.postOnly",
    );
    try {
      await sendBuilt(
        client,
        args.ownerWallet,
        args.owner,
        iocOpenTx(
          proxy,
          orderDesc({
            perpId,
            orderType: account.side === "long" ? ORDER_OPEN_LONG : ORDER_OPEN_SHORT,
            pricePNS: price,
            lotLNS: lot,
            leverageHdths: leverage,
            immediateOrCancel: true,
            maxMatches: 1n,
          }),
        ),
        "proxy.ioc",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : "reverted";
      console.log(`attempt ${attempt} ioc ${message?.slice(0, 160)}`);
    }
    const opened = await readPosition(client, args.exchange, perpId, accountId);
    console.log(`attempt ${attempt} lot=${opened.lotLNS}`);
    if (opened.lotLNS > 0n) return true;
  }
  console.error(`open failed ${proxy}`);
  return false;
}

async function tryBook(args: {
  client: PublicClient;
  owner: ReturnType<typeof loadRoles>["POOL_OWNER"];
  ownerWallet: ReturnType<typeof testnetWallet>;
  exchange: Address;
  proxy: Address;
  perpId: bigint;
  accountId: bigint;
  book: Book;
  side: PoolSide;
  lot: bigint;
  leverage: bigint;
  makerReduces: boolean;
}): Promise<boolean> {
  if (args.makerReduces) {
    console.log("skip book; self-match reduces the maker");
    return false;
  }
  const ons = args.side === "long" ? args.book.minAskPriceONS : args.book.maxBidPriceONS;
  if (ons === 0n) return false;
  const price = bookPricePNS(args.book.basePricePNS, ons);
  try {
    await sendBuilt(
      args.client,
      args.ownerWallet,
      args.owner,
      iocOpenTx(
        args.proxy,
        orderDesc({
          perpId: args.perpId,
          orderType: args.side === "long" ? ORDER_OPEN_LONG : ORDER_OPEN_SHORT,
          pricePNS: price,
          lotLNS: args.lot,
          leverageHdths: args.leverage,
          immediateOrCancel: true,
        }),
      ),
      "proxy.book",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "reverted";
    console.log(`book ioc ${message?.slice(0, 160)}`);
    return false;
  }
  const opened = await readPosition(args.client, args.exchange, args.perpId, args.accountId);
  console.log(`book fill lot=${opened.lotLNS}`);
  return opened.lotLNS > 0n;
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
    const selector = functionSelector(name);
    const allowed = (await client.readContract({
      address: proxy,
      abi: delegatedAccountAbi,
      functionName: "operatorAllowlist",
      args: [selector],
    })) as boolean;
    if (!allowed) continue;
    await sendBuilt(client, wallet, owner, built, `allowlist.${name}`);
  }
}

async function checkAccount(args: {
  client: PublicClient;
  exchange: Address;
  account: PoolAccount;
  owner: Address;
  operator: Address;
  market: PoolMarket;
}): Promise<boolean> {
  const { client, account } = args;
  const owner = (await client.readContract({
    address: account.proxy,
    abi: delegatedAccountAbi,
    functionName: "owner",
  })) as Address;
  const operatorOk = (await client.readContract({
    address: account.proxy,
    abi: delegatedAccountAbi,
    functionName: "isOperator",
    args: [args.operator],
  })) as boolean;
  const accountId = (await client.readContract({
    address: account.proxy,
    abi: delegatedAccountAbi,
    functionName: "accountId",
  })) as bigint;
  const info = (await client.readContract({
    address: args.exchange,
    abi: exchangeAbi,
    functionName: "getAccountById",
    args: [accountId],
  })) as { balanceCNS: bigint; lockedBalanceCNS: bigint };
  const free = info.balanceCNS > info.lockedBalanceCNS ? info.balanceCNS - info.lockedBalanceCNS : 0n;
  const position = await readPosition(client, args.exchange, BigInt(account.perpId), accountId);
  const book = await readBook(client, args.exchange, BigInt(account.perpId));
  const fractions = await client.readContract({
    address: args.exchange,
    abi: exchangeAbi,
    functionName: "getMarginFractions",
    args: [BigInt(account.perpId), 0n],
  });
  const hdths = maintHdths(fractions);
  const distance = contractDistanceE6(
    {
      positionType: position.positionType,
      pricePNS: position.pricePNS,
      lotLNS: position.lotLNS,
      depositCNS: position.depositCNS,
      premiumPnlCNS: position.premiumPnlCNS,
    },
    {
      priceDecimals: book.priceDecimals,
      lotDecimals: book.lotDecimals,
      maintHdths: hdths,
    },
    book.markPNS,
  );
  const band = distanceBand(args.market);
  const inBand = distance >= band.minE6 && distance <= band.maxE6;
  const sideOk = (account.side === "long" && position.positionType === 0) || (account.side === "short" && position.positionType === 1);
  const freeOk = free >= MIN_FREE_AUSD;
  const revoked = await revokedRevert(client, args.operator, account.proxy, BigInt(account.perpId));
  console.log(
    `${account.proxy} ownerOk=${owner.toLowerCase() === args.owner.toLowerCase()} operatorOk=${operatorOk} sideOk=${sideOk} free=${free} distanceE6=${distance} inBand=${inBand} revoked=${revoked} lot=${position.lotLNS}`,
  );
  return owner.toLowerCase() === args.owner.toLowerCase() && operatorOk && sideOk && freeOk && inBand && revoked && position.lotLNS > 0n;
}

async function revokedRevert(client: PublicClient, operator: Address, proxy: Address, perpId: bigint): Promise<boolean> {
  const calls: { name: string; data: Hex }[] = [
    {
      name: "execOrder",
      data: encodeFunctionData({
        abi: exchangeAbi,
        functionName: "execOrder",
        args: [orderDesc({ perpId, orderType: ORDER_OPEN_LONG, pricePNS: 1n, lotLNS: 1n, leverageHdths: 1500n })],
      }),
    },
    {
      name: "execOrders",
      data: encodeFunctionData({
        abi: exchangeAbi,
        functionName: "execOrders",
        args: [[orderDesc({ perpId, orderType: ORDER_OPEN_LONG, pricePNS: 1n, lotLNS: 1n, leverageHdths: 1500n })], false],
      }),
    },
    {
      name: "requestDecreasePositionCollateral",
      data: encodeFunctionData({
        abi: exchangeAbi,
        functionName: "requestDecreasePositionCollateral",
        args: [perpId, 1n, false],
      }),
    },
    {
      name: "buyLiquidations",
      data: encodeFunctionData({ abi: exchangeAbi, functionName: "buyLiquidations", args: [[], false] }),
    },
    {
      name: "depositCollateral",
      data: encodeFunctionData({ abi: exchangeAbi, functionName: "depositCollateral", args: [1n] }),
    },
    {
      name: "allowOrderForwarding",
      data: encodeFunctionData({ abi: exchangeAbi, functionName: "allowOrderForwarding", args: [false] }),
    },
  ];
  let reverted = 0;
  for (const call of calls) {
    try {
      await client.call({ account: operator, to: proxy, data: call.data });
      console.log(`${call.name} did not revert`);
    } catch {
      reverted += 1;
    }
  }
  return reverted === calls.length;
}

async function cancelMaker(
  client: PublicClient,
  wallet: ReturnType<typeof testnetWallet>,
  maker: ReturnType<typeof loadRoles>["MAKER"],
  exchange: Address,
  perpId: bigint,
) {
  const accountId = await accountIdOf(client, exchange, maker.address);
  if (accountId === null) return;
  const locks = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPerpOrderLocks",
    args: [accountId, perpId],
  })) as readonly { orderLockId: number; lotLNS: bigint }[];
  for (const lock of locks) {
    const orderId = BigInt(lock.orderLockId);
    if (orderId === 0n) continue;
    try {
      const order: OrderDesc = orderDesc({
        perpId,
        orderType: ORDER_CANCEL,
        orderId,
        pricePNS: 1n,
        lotLNS: lock.lotLNS === 0n ? 1n : lock.lotLNS,
        leverageHdths: 1500n,
      });
      await sendBuilt(client, wallet, maker, execOrderTx(exchange, order), "maker.cancel");
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : "reverted";
      console.log(`maker.cancel ${message?.slice(0, 160)}`);
    }
  }
}

async function reducesMaker(
  client: PublicClient,
  exchange: Address,
  maker: Address,
  perpId: bigint,
  poolSide: PoolSide,
): Promise<boolean> {
  const side = await makerSide(client, exchange, maker, perpId);
  return (side === "short" && poolSide === "short") || (side === "long" && poolSide === "long");
}

async function makerSide(client: PublicClient, exchange: Address, maker: Address, perpId: bigint): Promise<PoolSide | "flat"> {
  const lot = await makerLot(client, exchange, maker, perpId);
  if (lot > 0n) return "long";
  if (lot < 0n) return "short";
  return "flat";
}

async function makerLot(client: PublicClient, exchange: Address, maker: Address, perpId: bigint): Promise<bigint> {
  const accountId = await accountIdOf(client, exchange, maker);
  if (accountId === null) return 0n;
  const position = await readPosition(client, exchange, perpId, accountId);
  if (position.lotLNS === 0n) return 0n;
  return position.positionType === 0 ? position.lotLNS : -position.lotLNS;
}

async function positionLot(client: PublicClient, exchange: Address, proxy: Address, perpId: bigint): Promise<bigint> {
  const accountId = (await client.readContract({
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "accountId",
  })) as bigint;
  const position = await readPosition(client, exchange, perpId, accountId);
  return position.lotLNS === 0n ? 1n : position.lotLNS;
}

async function accountIdOf(client: PublicClient, exchange: Address, account: Address): Promise<bigint | null> {
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

async function readPosition(client: PublicClient, exchange: Address, perpId: bigint, accountId: bigint) {
  const result = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPositionV2",
    args: [perpId, accountId],
  })) as readonly [
    {
      positionType: number;
      lotLNS: bigint;
      depositCNS: bigint;
      pricePNS: bigint;
      premiumPnlCNS: bigint;
    },
    bigint,
    boolean,
  ];
  return result[0];
}

async function readBook(client: PublicClient, exchange: Address, perpId: bigint): Promise<Book> {
  const info = (await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getPerpetualInfoV2",
    args: [perpId],
  })) as {
    symbol: string;
    priceDecimals: bigint;
    lotDecimals: bigint;
    markPNS: bigint;
    basePricePNS: bigint;
    maxBidPriceONS: bigint;
    minAskPriceONS: bigint;
  };
  return {
    symbol: info.symbol,
    priceDecimals: Number(info.priceDecimals),
    lotDecimals: Number(info.lotDecimals),
    markPNS: info.markPNS,
    basePricePNS: info.basePricePNS,
    maxBidPriceONS: info.maxBidPriceONS,
    minAskPriceONS: info.minAskPriceONS,
  };
}

async function leverageFor(
  client: PublicClient,
  exchange: Address,
  perpId: bigint,
  lot: bigint,
  market: PoolMarket,
): Promise<bigint> {
  const fractions = await client.readContract({
    address: exchange,
    abi: exchangeAbi,
    functionName: "getMarginFractions",
    args: [perpId, lot],
  });
  const init = initHdths(fractions);
  return targetLeverageHdths(market, init);
}

function maintHdths(raw: unknown): bigint {
  if (Array.isArray(raw)) return raw[1] as bigint;
  return (raw as { perpMaintMarginFracHdths: bigint }).perpMaintMarginFracHdths;
}

function initHdths(raw: unknown): bigint {
  if (Array.isArray(raw)) return raw[0] as bigint;
  return (raw as { perpInitMarginFracHdths: bigint }).perpInitMarginFracHdths;
}
