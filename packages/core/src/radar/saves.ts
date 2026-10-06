export interface MarkSample {
  block: number;
  mark: bigint;
}

export type SaveOutcome = "save" | "none" | "liquidated";

/** A long is crossed when the mark prints at or below the pre-top-up liquidation price. */
export function markCrossed(side: "long" | "short", preLiq: bigint, mark: bigint): boolean {
  return side === "long" ? mark <= preLiq : mark >= preLiq;
}

/**
 * A save is the first mark that crosses the pre-top-up liquidation price
 * while the position is still open. A liquidation at or before that mark
 * is not a save. No cross is not a save.
 */
export function judgeSave(input: {
  side: "long" | "short";
  preLiq: bigint;
  marks: readonly MarkSample[];
  liquidatedAt?: number | null;
}): { outcome: SaveOutcome; block: number | null } {
  const ordered = [...input.marks].sort((left, right) => left.block - right.block);
  const cross = ordered.find((sample) => markCrossed(input.side, input.preLiq, sample.mark));
  if (!cross) {
    return input.liquidatedAt != null ? { outcome: "liquidated", block: input.liquidatedAt } : { outcome: "none", block: null };
  }
  if (input.liquidatedAt != null && input.liquidatedAt <= cross.block) {
    return { outcome: "liquidated", block: input.liquidatedAt };
  }
  return { outcome: "save", block: cross.block };
}
