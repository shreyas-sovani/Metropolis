import { describe, expect, it } from "vitest";
import { planTurnstile, turnstileOk, verifyTurnstile } from "../src/turnstile.js";

describe("turnstile", () => {
  it("rejects a guest with no token and lets an admin call through", () => {
    expect(planTurnstile(false, "")).toEqual({ action: "reject" });
    expect(planTurnstile(false, "token")).toEqual({ action: "verify", token: "token" });
    expect(planTurnstile(true, "")).toEqual({ action: "skip" });
  });

  it("accepts only a successful siteverify body", () => {
    expect(turnstileOk({ success: true })).toBe(true);
    expect(turnstileOk({ success: false })).toBe(false);
    expect(turnstileOk(null)).toBe(false);
  });

  it("returns false for an invalid token and never sends an empty secret", async () => {
    expect(await verifyTurnstile("token", "", "127.0.0.1", fetch)).toBe(false);
    let called = false;
    const fake: typeof fetch = async () => {
      called = true;
      return Response.json({ success: false });
    };
    expect(await verifyTurnstile("nope", "secret", "203.0.113.8", fake)).toBe(false);
    expect(called).toBe(true);
  });
});
