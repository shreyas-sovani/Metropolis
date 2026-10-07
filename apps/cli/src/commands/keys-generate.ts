import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const ROLE_KEYS = [
  "SPONSOR_PK",
  "POOL_OWNER_PK",
  "OPERATOR_PK",
  "MAKER_PK",
  "CALIBRATION_PK",
  "TEST_OWNER_PK",
] as const;

const SERVICE_KEYS = ["ADMIN_SECRET", "RADAR_SALT", "PROXY_SECRET"] as const;

export function workspaceRoot(start = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("workspace root not found");
}

function parseEnv(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^(?<key>[A-Z0-9_]+)=(?<value>.*)$/.exec(line);
    const key = match?.groups?.key;
    const value = match?.groups?.value;
    if (key === undefined || value === undefined) continue;
    values.set(key, value);
  }
  return values;
}

function isPrivateKey(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function writePrivate(file: string, body: string): void {
  writeFileSync(file, body, { encoding: "utf8", mode: 0o600 });
}

function ensureServices(file: string): void {
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const values = parseEnv(existing);
  const missing = SERVICE_KEYS.filter((key) => !values.get(key));
  if (existsSync(file) && missing.length === 0) {
    for (const key of SERVICE_KEYS) console.log(`services.env ${key} kept`);
    return;
  }

  const generated = new Map<string, string>();
  for (const key of missing) generated.set(key, randomBytes(32).toString("hex"));

  if (!existsSync(file)) {
    const lines = [
      "# Service credentials. Gitignored. Do not commit.",
      ...SERVICE_KEYS.map((key) => `${key}=${generated.get(key) ?? ""}`),
      "",
    ];
    writePrivate(file, lines.join("\n"));
  } else {
    const lines = existing.endsWith("\n") || existing.length === 0
      ? existing.split("\n")
      : [...existing.split("\n"), ""];
    if (lines.at(-1) === "") lines.pop();
    for (const key of missing) lines.push(`${key}=${generated.get(key) ?? ""}`);
    writePrivate(file, `${lines.join("\n")}\n`);
  }

  for (const key of SERVICE_KEYS) {
    console.log(`services.env ${key} ${missing.includes(key) ? "set" : "kept"}`);
  }
}

export function keysGenerate(root = workspaceRoot()): number {
  const secretsDir = path.join(root, "secrets");
  mkdirSync(secretsDir, { mode: 0o700, recursive: true });
  const keysFile = path.join(secretsDir, "testnet-keys.env");
  const servicesFile = path.join(secretsDir, "services.env");

  let body: string;
  if (existsSync(keysFile)) {
    body = readFileSync(keysFile, "utf8");
    console.log("testnet-keys.env unchanged");
  } else {
    const lines = ["# Testnet role keys. Gitignored. Do not commit."];
    const seen = new Set<string>();
    for (const name of ROLE_KEYS) {
      let key = generatePrivateKey();
      let address = privateKeyToAccount(key).address;
      while (seen.has(address)) {
        key = generatePrivateKey();
        address = privateKeyToAccount(key).address;
      }
      seen.add(address);
      lines.push(`${name}=${key}`);
    }
    body = `${lines.join("\n")}\n`;
    writePrivate(keysFile, body);
    console.log("testnet-keys.env created");
  }

  const values = parseEnv(body);
  const addresses = new Set<string>();
  for (const name of ROLE_KEYS) {
    const key = values.get(name);
    if (!key || !isPrivateKey(key)) {
      console.error(`${name} missing or invalid`);
      return 1;
    }
    const address = privateKeyToAccount(key as `0x${string}`).address;
    if (addresses.has(address)) {
      console.error(`${name} address collides with another role`);
      return 1;
    }
    addresses.add(address);
    console.log(`${name.replace(/_PK$/, "")} ${address}`);
  }

  ensureServices(servicesFile);
  return 0;
}
