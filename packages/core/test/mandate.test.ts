import { describe, expect, it } from "vitest";
import { hashTypedData, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  MANDATE_MAX_EXPIRY_SEC,
  buildMandate,
  hashMandate,
  mandateDomain,
  mandateMessage,
  mandateTypes,
  recoverSigner,
  validateMandate,
  type MandateMessage,
} from "../src/lifeline/mandate.js";

const KEY = `0x${"33".repeat(32)}` as const;
const NOW = 1_700_000_000n;

function valid(overrides: Partial<MandateMessage> = {}): MandateMessage {
  return buildMandate({
    account: "0x00000000000000000000000000000000000000b1",
    perpIds: [16n],
    triggerBps: 400,
    targetBps: 600,
    maxPerActionCNS: 150_000_000n,
    budgetCNS: 50_000_000n,
    expiry: NOW + 7n * 24n * 60n * 60n,
    nonce: 1n,
    ...overrides,
  });
}

const ctx = { nowSec: NOW, accountPerpIds: [16n, 2n], usedNonces: [9n] };

describe("mandate", () => {
  it("recovers the signer of the PRD §F5 typed data", async () => {
    const account = privateKeyToAccount(KEY);
    const message = mandateMessage({
      account: "0x00000000000000000000000000000000000000b1",
      perpId: 16n,
    });
    const signature = await account.signTypedData({
      domain: mandateDomain(),
      types: mandateTypes,
      primaryType: "Mandate",
      message,
    });
    expect(await recoverSigner(message, signature)).toBe(account.address);
    expect(hashMandate(message)).toBe(
      hashTypedData({ domain: mandateDomain(), types: mandateTypes, primaryType: "Mandate", message }),
    );
    expect(message.triggerBps).toBe(400);
    expect(message.targetBps).toBe(600);
  });

  it("rejects a signature after any single field changes", async () => {
    const account = privateKeyToAccount(KEY);
    const message = valid();
    const signature = await account.signTypedData({
      domain: mandateDomain(),
      types: mandateTypes,
      primaryType: "Mandate",
      message,
    });
    expect(await recoverTypedDataAddress({
      domain: mandateDomain(),
      types: mandateTypes,
      primaryType: "Mandate",
      message,
      signature,
    })).toBe(account.address);
    const changed: MandateMessage[] = [
      { ...message, account: "0x00000000000000000000000000000000000000b2" },
      { ...message, perpIds: [17n] },
      { ...message, triggerBps: 401 },
      { ...message, targetBps: 601 },
      { ...message, maxPerActionCNS: message.maxPerActionCNS + 1n },
      { ...message, budgetCNS: message.budgetCNS + 1n },
      { ...message, expiry: message.expiry + 1n },
      { ...message, nonce: message.nonce + 1n },
    ];
    for (const next of changed) {
      expect(await recoverSigner(next, signature)).not.toBe(account.address);
    }
  });

  it("accepts a sane mandate and fails each rule", () => {
    expect(validateMandate(valid(), ctx)).toEqual({ ok: true });
    expect(validateMandate(valid({ triggerBps: 0 }), ctx).ok).toBe(false);
    expect(validateMandate(valid({ triggerBps: 600, targetBps: 600 }), ctx)).toEqual({ ok: false, reason: "trigger" });
    expect(validateMandate(valid({ targetBps: 2001 }), ctx)).toEqual({ ok: false, reason: "target" });
    expect(validateMandate(valid({ maxPerActionCNS: 0n }), ctx)).toEqual({ ok: false, reason: "cap" });
    expect(validateMandate(valid({ budgetCNS: 0n }), ctx)).toEqual({ ok: false, reason: "cap" });
    expect(validateMandate(valid({ expiry: NOW }), ctx)).toEqual({ ok: false, reason: "expiry" });
    expect(validateMandate(valid({ expiry: NOW + MANDATE_MAX_EXPIRY_SEC + 1n }), ctx)).toEqual({
      ok: false,
      reason: "expiry",
    });
    expect(validateMandate(valid({ perpIds: [] }), ctx)).toEqual({ ok: false, reason: "market" });
    expect(validateMandate(valid({ perpIds: [99n] }), ctx)).toEqual({ ok: false, reason: "market" });
    expect(validateMandate(valid({ nonce: 9n }), ctx)).toEqual({ ok: false, reason: "nonce" });
  });
});
