import { describe, expect, it } from "vitest";
import { nextNonce } from "../src/tick.js";

describe("nonce resync", () => {
  it("jumps to the chain when external sends moved ahead", () => {
    expect(nextNonce(133, 200)).toBe(200);
    expect(nextNonce(null, 4)).toBe(4);
    expect(nextNonce(12, 9)).toBe(9);
    expect(nextNonce(10, 9)).toBe(10);
  });
});
