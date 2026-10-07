import { describe, expect, it } from "vitest";
import { firstSampleBelowTrigger } from "@lifeline/core";
import replay from "../data/mainnet-replay.json";

describe("mainnet liquidation replay", () => {
  it("matches the event tick and acts on the first sample inside the trigger", () => {
    expect(replay.forkLiqPricePNS).toBe(replay.eventLiqPricePNS);
    const act = firstSampleBelowTrigger(replay.samples, BigInt(replay.triggerE6));
    expect(act?.block).toBe(replay.wouldAct.block);
    expect(act?.distanceE6).toBe(replay.wouldAct.distanceE6);
    expect(BigInt(replay.samples[0]?.distanceE6 ?? "0") < BigInt(replay.triggerE6)).toBe(true);
  });
});
