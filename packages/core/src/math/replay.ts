export interface ReplayedPosition {
  side: 1n | -1n;
  entryPNS: bigint;
  lotLNS: bigint;
  depositCNS: bigint;
}

export type LifecycleStep =
  | {
      kind: "open";
      block: number;
      index: number;
      positionType: number;
      pricePNS: bigint;
      lotLNS: bigint;
      depositCNS: bigint;
    }
  | {
      kind: "increase";
      block: number;
      index: number;
      pricePNS: bigint;
      startLotLNS: bigint;
      endLotLNS: bigint;
      endDepositCNS: bigint;
    }
  | {
      kind: "decrease";
      block: number;
      index: number;
      endLotLNS: bigint;
      endDepositCNS: bigint;
    }
  | {
      kind: "collateral";
      block: number;
      index: number;
      depositCNS: bigint;
    };

function sideOf(positionType: number): 1n | -1n {
  return positionType === 0 ? 1n : -1n;
}

/** 4% in distance units. Lifeline's default trigger. */
export const REPLAY_TRIGGER_E6 = 40_000n;

/** The earliest sample whose distance is already inside the trigger. */
export function firstSampleBelowTrigger<T extends { block: number; distanceE6: string }>(
  samples: readonly T[],
  triggerE6 = REPLAY_TRIGGER_E6,
): T | null {
  const ordered = [...samples].sort((left, right) => left.block - right.block);
  return ordered.find((sample) => BigInt(sample.distanceE6) < triggerE6) ?? null;
}

/** Replay entry, lot, and deposit up to, but not including, a later block. */
export function replayPosition(steps: readonly LifecycleStep[], beforeBlock: number): ReplayedPosition | null {
  const ordered = [...steps]
    .filter((step) => step.block < beforeBlock)
    .sort((left, right) => left.block - right.block || left.index - right.index);
  let position: ReplayedPosition | null = null;
  for (const step of ordered) {
    if (step.kind === "open") {
      position = {
        side: sideOf(step.positionType),
        entryPNS: step.pricePNS,
        lotLNS: step.lotLNS,
        depositCNS: step.depositCNS,
      };
      continue;
    }
    if (!position) continue;
    if (step.kind === "increase") {
      const added = step.endLotLNS - step.startLotLNS;
      if (step.endLotLNS > 0n) {
        position.entryPNS = (position.entryPNS * step.startLotLNS + step.pricePNS * added) / step.endLotLNS;
      }
      position.lotLNS = step.endLotLNS;
      position.depositCNS = step.endDepositCNS;
      continue;
    }
    if (step.kind === "decrease") {
      position.lotLNS = step.endLotLNS;
      position.depositCNS = step.endDepositCNS;
      if (position.lotLNS === 0n) position = null;
      continue;
    }
    position.depositCNS = step.depositCNS;
  }
  if (!position || position.lotLNS <= 0n) return null;
  return position;
}
