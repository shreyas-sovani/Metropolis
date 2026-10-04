import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";

describe("cli", () => {
  it("prints help for no args", async () => {
    expect(await run([])).toBe(0);
  });

  it("rejects an unknown command", async () => {
    expect(await run(["nope"])).toBe(1);
  });
});
