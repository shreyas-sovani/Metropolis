import { describe, expect, it } from "vitest";
import { perpIdsFromBitmap } from "../src/chain/bitmap.js";
import { lotSums, slicePositionPage } from "../src/chain/positions.js";

describe("chain readers", () => {
  it("reads perp ids out of a 256-bit bitmap", () => {
    const bitmap = [0n, 0n, 0n, 0n];
    bitmap[0] = (1n << 1n) | (1n << 10n);
    bitmap[1] = 1n << 4n;
    expect(perpIdsFromBitmap(bitmap)).toEqual([1, 10, 260]);
  });

  it("keeps only the live prefix of a padded position page", () => {
    const page = [
      { accountId: 1n, nextNodeId: 2n },
      { accountId: 2n, nextNodeId: 9n },
      { accountId: 0n, nextNodeId: 0n },
    ];
    expect(slicePositionPage(page, 2n)).toEqual({
      positions: [page[0], page[1]],
      nextNodeId: 9n,
    });
    expect(slicePositionPage(page, 0n)).toEqual({ positions: [], nextNodeId: 0n });
  });

  it("sums long and short lots separately", () => {
    expect(
      lotSums([
        { positionType: 0, lotLNS: 10n },
        { positionType: 1, lotLNS: 4n },
        { positionType: 0, lotLNS: 3n },
      ]),
    ).toEqual({ longOpenInterestLNS: 13n, shortOpenInterestLNS: 4n });
  });
});
