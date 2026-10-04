import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { ROLE_KEYS, keysGenerate } from "../src/commands/keys-generate.js";

const roots: string[] = [];

function root(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lifeline-keys-"));
  writeFileSync(path.join(dir, "pnpm-workspace.yaml"), "packages: []\n");
  roots.push(dir);
  return dir;
}

afterEach(() => {
  roots.splice(0);
});

describe("keys:generate", () => {
  it("writes six distinct keys and leaves them unchanged on rerun", () => {
    const dir = root();
    expect(keysGenerate(dir)).toBe(0);
    const file = path.join(dir, "secrets", "testnet-keys.env");
    const first = readFileSync(file);
    const digest = createHash("sha256").update(first).digest("hex");
    expect(keysGenerate(dir)).toBe(0);
    const second = readFileSync(file);
    expect(createHash("sha256").update(second).digest("hex")).toBe(digest);

    const addresses = new Set<string>();
    for (const line of second.toString("utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(0x[0-9a-fA-F]{64})$/.exec(line);
      if (!match) continue;
      expect(ROLE_KEYS).toContain(match[1]);
      addresses.add(privateKeyToAccount(match[2] as `0x${string}`).address);
    }
    expect(addresses.size).toBe(6);

    const services = readFileSync(path.join(dir, "secrets", "services.env"), "utf8");
    expect(services).toMatch(/^ADMIN_SECRET=[0-9a-f]{64}$/m);
    expect(services).toMatch(/^RADAR_SALT=[0-9a-f]{64}$/m);
  });

  it("does not overwrite an existing service value", () => {
    const dir = root();
    const secrets = path.join(dir, "secrets");
    writeFileSync(
      path.join(dir, "pnpm-workspace.yaml"),
      "packages: []\n",
    );
    mkdirSync(secrets, { recursive: true });
    writeFileSync(
      path.join(secrets, "services.env"),
      "ADMIN_SECRET=already-set\nENVIO_API_TOKEN=\n",
    );
    expect(keysGenerate(dir)).toBe(0);
    const services = readFileSync(path.join(secrets, "services.env"), "utf8");
    expect(services).toContain("ADMIN_SECRET=already-set");
    expect(services).toContain("ENVIO_API_TOKEN=");
    expect(services).toMatch(/^RADAR_SALT=[0-9a-f]{64}$/m);
  });
});
