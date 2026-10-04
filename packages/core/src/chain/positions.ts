/** Long is 0 and short is 1, matching the Exchange `positionType` enum. */
export const POSITION_LONG = 0;
export const POSITION_SHORT = 1;

/** `getPositionsV2` page size from PRD §5.2. */
export const POSITION_PAGE_SIZE = 200n;

export interface PositionNode {
  accountId: bigint;
  nextNodeId: bigint;
  prevNodeId: bigint;
  positionType: number;
  depositCNS: bigint;
  pricePNS: bigint;
  lotLNS: bigint;
  entryBlock: bigint;
  pnlCNS: bigint;
  deltaPnlCNS: bigint;
  premiumPnlCNS: bigint;
  priceResiduePNSQ16: bigint;
}

/**
 * `getPositionsV2` returns a fixed-length array. Only the first `numPositions`
 * entries are live; the next page starts at the last live node's `nextNodeId`.
 */
export function slicePositionPage<T extends { nextNodeId: bigint }>(
  positions: readonly T[],
  numPositions: bigint,
): { positions: T[]; nextNodeId: bigint } {
  const count = Number(numPositions);
  if (!Number.isInteger(count) || count < 0 || count > positions.length) {
    throw new Error(`numPositions ${numPositions} is outside a page of ${positions.length}`);
  }
  const live = positions.slice(0, count);
  const last = live[count - 1];
  return { positions: live, nextNodeId: last ? last.nextNodeId : 0n };
}

export function lotSums(positions: readonly { positionType: number; lotLNS: bigint }[]): {
  longOpenInterestLNS: bigint;
  shortOpenInterestLNS: bigint;
} {
  let longOpenInterestLNS = 0n;
  let shortOpenInterestLNS = 0n;
  for (const position of positions) {
    if (position.positionType === POSITION_LONG) longOpenInterestLNS += position.lotLNS;
    else if (position.positionType === POSITION_SHORT) shortOpenInterestLNS += position.lotLNS;
    else throw new Error(`unknown positionType ${position.positionType}`);
  }
  return { longOpenInterestLNS, shortOpenInterestLNS };
}
