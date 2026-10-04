import { describe, expect, it } from "vitest";
import { CORE_NAME } from "../src/index.js";

describe("core", () => {
  it("identifies the package", () => {
    expect(CORE_NAME).toBe("@lifeline/core");
  });
});
