/** `OrderDescEnum` from dex-sdk `RequestType`. Increase collateral is 5. */
export const ORDER_OPEN_LONG = 0;
export const ORDER_OPEN_SHORT = 1;
export const ORDER_CLOSE_LONG = 2;
export const ORDER_CLOSE_SHORT = 3;
export const ORDER_CANCEL = 4;
export const ORDER_INCREASE_COLLATERAL = 5;
export const ORDER_CHANGE = 6;

export interface OrderDesc {
  orderDescId: bigint;
  perpId: bigint;
  orderType: number;
  orderId: bigint;
  pricePNS: bigint;
  lotLNS: bigint;
  expiryBlock: bigint;
  postOnly: boolean;
  fillOrKill: boolean;
  immediateOrCancel: boolean;
  maxMatches: bigint;
  leverageHdths: bigint;
  lastExecutionBlock: bigint;
  amountCNS: bigint;
  maxNegPnlCollatBPS: bigint;
}

export function orderDesc(fields: {
  perpId: bigint;
  orderType: number;
  pricePNS: bigint;
  lotLNS: bigint;
  leverageHdths: bigint;
  postOnly?: boolean;
  immediateOrCancel?: boolean;
  amountCNS?: bigint;
  orderDescId?: bigint;
  orderId?: bigint;
  maxNegPnlCollatBPS?: bigint;
  maxMatches?: bigint;
}): OrderDesc {
  return {
    orderDescId: fields.orderDescId ?? 1n,
    perpId: fields.perpId,
    orderType: fields.orderType,
    orderId: fields.orderId ?? 0n,
    pricePNS: fields.pricePNS,
    lotLNS: fields.lotLNS,
    expiryBlock: 0n,
    postOnly: fields.postOnly ?? false,
    fillOrKill: false,
    immediateOrCancel: fields.immediateOrCancel ?? false,
    maxMatches: fields.maxMatches ?? 0n,
    leverageHdths: fields.leverageHdths,
    lastExecutionBlock: 0n,
    amountCNS: fields.amountCNS ?? 0n,
    // dex-sdk default. 0 reverts taker settlement (result code 14) on testnet.
    maxNegPnlCollatBPS: fields.maxNegPnlCollatBPS ?? 1000n,
  };
}

/** Book prices are `basePricePNS + priceONS` in mark fixed-point units. */
export function bookPricePNS(basePricePNS: bigint, priceONS: bigint): bigint {
  return basePricePNS + priceONS;
}

/**
 * Post-only ask near mark + `bps` (default 5 = 0.05%), kept strictly inside
 * the spread so it rests and does not take existing bids or join the ask queue.
 */
export function restingAskPricePNS(args: {
  markPNS: bigint;
  basePricePNS: bigint;
  maxBidPriceONS: bigint;
  minAskPriceONS: bigint;
  bps?: bigint;
}): bigint {
  const bps = args.bps ?? 5n;
  const bestBid = args.maxBidPriceONS === 0n ? 0n : bookPricePNS(args.basePricePNS, args.maxBidPriceONS);
  const bestAsk = args.minAskPriceONS === 0n ? 0n : bookPricePNS(args.basePricePNS, args.minAskPriceONS);
  let price = (args.markPNS * (10_000n + bps)) / 10_000n;
  const lower = bestBid === 0n ? 0n : bestBid + 1n;
  const upper = bestAsk === 0n ? 0n : bestAsk - 1n;
  if (upper > lower) {
    if (price < lower) price = lower;
    if (price > upper) price = upper;
    return price;
  }
  if (bestAsk !== 0n) return bestAsk;
  if (price <= bestBid) return bestBid + 1n;
  return price;
}

/** Leverage in hundredths from entry price, lot, and deposit. 1500 = 15×. */
export function leverageHdths(args: {
  pricePNS: bigint;
  priceDecimals: number;
  lotLNS: bigint;
  lotDecimals: number;
  depositCNS: bigint;
}): bigint {
  if (args.depositCNS <= 0n) return 0n;
  const priceScale = 10n ** BigInt(args.priceDecimals);
  const lotScale = 10n ** BigInt(args.lotDecimals);
  return (args.pricePNS * args.lotLNS * 1_000_000n * 100n) / (priceScale * lotScale * args.depositCNS);
}
