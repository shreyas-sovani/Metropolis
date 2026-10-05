import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { disarmMessage, mandateFromBody } from "../src/arm.js";

describe("arm messages", () => {
  it("binds a disarm signature to the proxy and nonce", () => {
    const proxy = getAddress("0x00000000000000000000000000000000000000aa");
    expect(disarmMessage(proxy, "4")).toBe(`lifeline-disarm:${proxy}:4`);
  });

  it("rejects a mandate body without an account", () => {
    expect(() => mandateFromBody({ perpIds: ["16"] })).toThrow(/mandate/);
  });
});
