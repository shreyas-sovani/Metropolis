import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("V13 routing cleanup", () => {
  it("drops the old dark tokens and keeps the redirects", () => {
    const css = ["app/globals.css", "app/styles/base.css", "app/styles/tokens.css", "app/ui/contract-exact-badge.css"]
      .map((file) => readFileSync(path.join(root, file), "utf8"))
      .join("\n");
    expect(css).not.toMatch(/--amber|--panel/);
    const config = readFileSync(path.join(root, "next.config.ts"), "utf8");
    expect(config).toContain('source: "/lifeline"');
    expect(config).toContain('destination: "/app"');
    expect(config).toContain('source: "/judges"');
    expect(config).toContain('destination: "/tour"');
    expect(config).toContain('value: "10143"');
  });
});
