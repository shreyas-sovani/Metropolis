import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";

describe("cli", () => {
  it("prints help for no args", () => {
    expect(run([])).toBe(0);
  });

  it("rejects an unknown command", () => {
    expect(run(["nope"])).toBe(1);
  });
});
