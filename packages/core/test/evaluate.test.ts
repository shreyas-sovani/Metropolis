import { describe, expect, it } from "vitest";
import {
  MICRO,
  desiredDepositMicro,
  lotFromNotional,
} from "../src/math/index.js";
import { evaluate, type EvalAccount, type EvalPosition } from "../src/lifeline/evaluate.js";
import { buildMandate, type MandateMessage } from "../src/lifeline/mandate.js";

const NOW = 1_700_000_000n;

function position(overrides: Partial<EvalPosition> = {}): EvalPosition {
  const entryMicro = 85_260n * MICRO;
  return {
    markPriceValid: true,
    open: true,
    side: 1n,
    positionType: 0,
    entryMicro,
    lot: lotFromNotional(entryMicro, 1_500n * MICRO),
    depositMicro: 100n * MICRO,
    fundingMicro: 0n,
    mmf: 25n,
    markMicro: entryMicro,
    pricePNS: entryMicro,
    lotLNS: lotFromNotional(entryMicro, 1_500n * MICRO),
    priceDecimals: 6,
    lotDecimals: 18,
    maintHdths: 2_500n,
    markPNS: entryMicro,
    ...overrides,
  };
}

function mandate(overrides: Partial<MandateMessage> = {}): MandateMessage {
  return buildMandate({
    account: "0x00000000000000000000000000000000000000b1",
    perpIds: [16n],
    triggerBps: 400,
    targetBps: 600,
    maxPerActionCNS: 150n * MICRO,
    budgetCNS: 300n * MICRO,
    expiry: NOW + 86_400n,
    nonce: 1n,
    ...overrides,
  });
}

function account(overrides: Partial<EvalAccount> = {}): EvalAccount {
  return { freeBalanceMicro: 300n * MICRO, paused: false, nowSec: NOW, ...overrides };
}

describe("evaluator", () => {
  it("skips for every reason", () => {
    const base = position();
    const order = mandate();
    expect(evaluate(order, { ...base, markPriceValid: false }, account(), null, 10n, 0n)).toEqual({
      action: "skip",
      reason: "MARK_INVALID",
    });
    expect(evaluate(order, { ...base, open: false }, account(), null, 10n, 0n)).toEqual({
      action: "skip",
      reason: "NO_POSITION",
    });
    expect(evaluate(mandate({ triggerBps: 100 }), base, account(), null, 10n, 0n)).toEqual({
      action: "skip",
      reason: "ABOVE_TRIGGER",
    });
    expect(evaluate(order, base, account(), 10n, 12n, 0n)).toEqual({ action: "skip", reason: "COOLDOWN" });
    expect(evaluate(order, base, account(), null, 10n, order.budgetCNS)).toEqual({
      action: "skip",
      reason: "BUDGET_EXHAUSTED",
    });
    expect(evaluate(mandate({ maxPerActionCNS: MICRO }), base, account(), null, 10n, 0n)).toEqual({
      action: "skip",
      reason: "BELOW_MIN",
    });
    expect(evaluate(order, base, account({ freeBalanceMicro: 0n }), null, 10n, 0n)).toEqual({
      action: "skip",
      reason: "NO_FREE_BALANCE",
    });
    expect(evaluate(mandate({ expiry: NOW }), base, account(), null, 10n, 0n)).toEqual({
      action: "skip",
      reason: "EXPIRED",
    });
    expect(evaluate(order, base, account({ paused: true }), null, 10n, 0n)).toEqual({
      action: "skip",
      reason: "PAUSED",
    });
  });

  it("tops up and never exceeds a cap", () => {
    const pos = position();
    const order = mandate();
    const result = evaluate(order, pos, account(), null, 20n, 0n);
    expect(result.action).toBe("topUp");
    if (result.action !== "topUp") return;
    expect(result.amountCNS).toBeGreaterThanOrEqual(5n * MICRO);
    expect(result.amountCNS).toBeLessThanOrEqual(order.maxPerActionCNS);
    expect(Object.keys(result).sort()).toEqual(["action", "amountCNS", "distBefore", "distTarget"]);
    const desired = desiredDepositMicro({ ...pos, targetBps: BigInt(order.targetBps) });
    const raw = desired - pos.depositMicro;
    expect(result.amountCNS).toBe(raw > order.maxPerActionCNS ? order.maxPerActionCNS : raw);

    let seed = 1;
    const next = () => {
      seed = (seed * 16807) % 2147483647;
      return seed;
    };
    for (let i = 0; i < 40; i += 1) {
      const maxPer = BigInt(next() % 200) * MICRO;
      const free = BigInt(next() % 200) * MICRO;
      const budget = BigInt(next() % 200) * MICRO;
      const used = BigInt(next() % 50) * MICRO;
      const trial = mandate({ maxPerActionCNS: maxPer === 0n ? 1n : maxPer, budgetCNS: budget + used + 1n });
      const outcome = evaluate(trial, pos, account({ freeBalanceMicro: free }), null, 30n, used);
      if (outcome.action === "skip") {
        expect(outcome.reason).not.toBeUndefined();
        continue;
      }
      const left = trial.budgetCNS - used;
      expect(outcome.amountCNS).toBeLessThanOrEqual(trial.maxPerActionCNS);
      expect(outcome.amountCNS).toBeLessThanOrEqual(free);
      expect(outcome.amountCNS).toBeLessThanOrEqual(left);
      expect(outcome.amountCNS).toBeGreaterThanOrEqual(5n * MICRO);
    }
  });
});
