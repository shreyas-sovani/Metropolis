import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PUBLIC_RPC_URLS, TESTNET_ID } from "@lifeline/core";
import { workspaceRoot } from "./keys-generate.js";
import { alchemyTestnetUrl } from "../roles.js";

export const WORKER_SECRET_NAMES = [
  "OPERATOR_PK",
  "POOL_OWNER_PK",
  "SPONSOR_PK",
  "ADMIN_SECRET",
  "PRIVY_APP_ID",
  "PRIVY_VERIFICATION_KEY",
  "RPC_URLS_TESTNET",
  "LIFELINE_PAUSED",
  "TURNSTILE_SECRET",
  "PROXY_SECRET",
] as const;

function envMap(file: string): Map<string, string> {
  const values = new Map<string, string>();
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return values;
  }
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const split = line.indexOf("=");
    if (split <= 0) continue;
    values.set(line.slice(0, split), line.slice(split + 1).trim());
  }
  return values;
}

function putSecret(root: string, name: string, value: string): boolean {
  const result = spawnSync("pnpm", ["exec", "wrangler", "secret", "put", name], {
    cwd: path.join(root, "apps", "worker"),
    input: value,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(`secret ${name} failed`);
    return false;
  }
  console.log(`secret ${name} set`);
  return true;
}

export async function secretsSyncWorker(root = workspaceRoot()): Promise<number> {
  const keys = envMap(path.join(root, "secrets", "testnet-keys.env"));
  const services = envMap(path.join(root, "secrets", "services.env"));
  const urls = [...PUBLIC_RPC_URLS[TESTNET_ID]];
  const alchemy = alchemyTestnetUrl(root);
  if (alchemy) urls.push(alchemy);
  const values = new Map<string, string>([
    ["OPERATOR_PK", keys.get("OPERATOR_PK") ?? ""],
    ["POOL_OWNER_PK", keys.get("POOL_OWNER_PK") ?? ""],
    ["SPONSOR_PK", keys.get("SPONSOR_PK") ?? ""],
    ["ADMIN_SECRET", services.get("ADMIN_SECRET") ?? ""],
    ["PRIVY_APP_ID", services.get("PRIVY_APP_ID") ?? ""],
    ["PRIVY_VERIFICATION_KEY", services.get("PRIVY_VERIFICATION_KEY") ?? ""],
    ["RPC_URLS_TESTNET", urls.join(",")],
    ["LIFELINE_PAUSED", services.get("LIFELINE_PAUSED") || "false"],
    ["TURNSTILE_SECRET", services.get("TURNSTILE_SECRET") ?? ""],
    ["PROXY_SECRET", services.get("PROXY_SECRET") ?? ""],
  ]);
  let failed = false;
  for (const name of WORKER_SECRET_NAMES) {
    const value = values.get(name) ?? "";
    if (!value) {
      console.error(`secret ${name} missing`);
      failed = true;
      continue;
    }
    if (!putSecret(root, name, value)) failed = true;
  }
  return failed ? 1 : 0;
}
