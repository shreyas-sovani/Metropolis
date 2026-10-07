import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAINNET_ID, PUBLIC_RPC_URLS, TESTNET_ID } from "@lifeline/core";
import { workspaceRoot } from "./keys-generate.js";

export const WORKER_ORIGIN = "https://lifeline.lifeline-shreyas.workers.dev";

const SECRET_NAMES = new Set(["ENVIO_API_TOKEN", "RADAR_SALT", "RPC_URLS_MAINNET", "RPC_URLS_TESTNET"]);

export interface VercelEnvItem {
  name: string;
  value: string;
  sensitive: boolean;
}

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

function withAlchemy(urls: readonly string[], alchemy: string | undefined): string {
  const next = [...urls];
  if (alchemy && !next.includes(alchemy)) next.push(alchemy);
  return next.join(",");
}

/** Public app settings plus server tokens. Empty client id is omitted. */
export function vercelEnvPlan(services: Map<string, string>, workerOrigin = WORKER_ORIGIN): VercelEnvItem[] {
  const rows: [string, string][] = [
    ["NEXT_PUBLIC_PRIVY_APP_ID", services.get("PRIVY_APP_ID") ?? ""],
    ["NEXT_PUBLIC_PRIVY_CLIENT_ID", services.get("PRIVY_CLIENT_ID") ?? ""],
    ["NEXT_PUBLIC_WORKER_URL", workerOrigin],
    ["WORKER_HEALTH_URL", `${workerOrigin}/health`],
    ["ENVIO_API_TOKEN", services.get("ENVIO_API_TOKEN") ?? ""],
    ["RADAR_SALT", services.get("RADAR_SALT") ?? ""],
    ["TURNSTILE_SITE_KEY", services.get("TURNSTILE_SITE_KEY") ?? ""],
    ["RPC_URLS_MAINNET", withAlchemy(PUBLIC_RPC_URLS[MAINNET_ID], services.get("ALCHEMY_MONAD_MAINNET_URL"))],
    ["RPC_URLS_TESTNET", withAlchemy(PUBLIC_RPC_URLS[TESTNET_ID], services.get("ALCHEMY_MONAD_TESTNET_URL"))],
  ];
  return rows.flatMap(([name, value]) => {
    if (name === "NEXT_PUBLIC_PRIVY_CLIENT_ID" && !value) return [];
    return [{ name, value, sensitive: SECRET_NAMES.has(name) }];
  });
}

function putEnv(root: string, item: VercelEnvItem): boolean {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "vercel",
      "env",
      "add",
      item.name,
      "production,preview,development",
      "--force",
      "--yes",
      item.sensitive ? "--sensitive" : "--no-sensitive",
      "--value",
      item.value,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error(`env ${item.name} failed`);
    return false;
  }
  console.log(`env ${item.name} set`);
  return true;
}

export async function secretsSyncVercel(root = workspaceRoot()): Promise<number> {
  const services = envMap(path.join(root, "secrets", "services.env"));
  const plan = vercelEnvPlan(services);
  let failed = false;
  for (const item of plan) {
    if (!item.value) {
      console.error(`env ${item.name} missing`);
      failed = true;
      continue;
    }
    if (!putEnv(root, item)) failed = true;
  }
  return failed ? 1 : 0;
}
