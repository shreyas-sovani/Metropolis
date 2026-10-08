import { readFileSync } from "node:fs";
import path from "node:path";
import { buildMandate, delegatedAccountAbi, recoverSigner } from "@lifeline/core";
import { getAddress, type Address, type Hex, type PublicClient } from "viem";
import { workspaceRoot } from "./keys-generate.js";
import { loadRoles } from "../roles.js";
import { testnetPublicClient } from "../testnet.js";

export const DEFAULT_WORKER_URL = "https://lifeline.lifeline-shreyas.workers.dev";

export interface PlannedEntry {
  proxy: Address;
  perpId: string;
  side: "long" | "short";
  leverage: string;
  market: string;
  role: "pool" | "twin-protected" | "twin-unprotected" | "sandbox";
  pairId: string;
}

interface PoolFile {
  accounts?: { proxy?: string; market?: string; side?: string; perpId?: string; role?: string }[];
}

interface TwinsFile {
  pairs?: {
    id?: string;
    market?: string;
    side?: string;
    perpId?: string;
    leverageHdths?: string;
    protected?: { proxy?: string | null };
    unprotected?: { proxy?: string | null };
  }[];
}

export function poolLeverage(market: string): string {
  if (market === "BTC") return "1500";
  if (market === "ETH") return "1200";
  throw new Error(`unsupported pool market ${market}`);
}

function sideOf(value: string | undefined, label: string): "long" | "short" {
  if (value === "long" || value === "short") return value;
  throw new Error(`${label} side`);
}

export function planEntries(pool: PoolFile, twins: TwinsFile): PlannedEntry[] {
  const entries: PlannedEntry[] = [];
  for (const account of pool.accounts ?? []) {
    if (!account.proxy || !account.market || !account.perpId) throw new Error("pool entry incomplete");
    entries.push({
      proxy: getAddress(account.proxy),
      perpId: account.perpId,
      side: sideOf(account.side, account.proxy),
      leverage: poolLeverage(account.market),
      market: account.market,
      role: account.role === "sandbox" ? "sandbox" : "pool",
      pairId: "",
    });
  }
  for (const pair of twins.pairs ?? []) {
    if (!pair.id || !pair.market || !pair.perpId || !pair.leverageHdths) throw new Error("twin entry incomplete");
    const legs = [
      { role: "twin-protected" as const, proxy: pair.protected?.proxy },
      { role: "twin-unprotected" as const, proxy: pair.unprotected?.proxy },
    ];
    for (const leg of legs) {
      if (!leg.proxy) throw new Error(`${pair.id} ${leg.role} missing`);
      entries.push({
        proxy: getAddress(leg.proxy),
        perpId: pair.perpId,
        side: sideOf(pair.side, pair.id),
        leverage: pair.leverageHdths,
        market: pair.market,
        role: leg.role,
        pairId: pair.id,
      });
    }
  }
  return entries;
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function adminSecret(root: string): string {
  const file = path.join(root, "secrets", "services.env");
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.startsWith("ADMIN_SECRET=")) continue;
    return line.slice("ADMIN_SECRET=".length).trim();
  }
  return "";
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

interface StoredMandate {
  owner: Address;
  kind: string;
  sig: Hex;
  typedData: {
    account: Address;
    perpIds: string[];
    triggerBps: number;
    targetBps: number;
    maxPerActionCNS: string;
    budgetCNS: string;
    expiry: string;
    nonce: string;
  };
}

/**
 * Reads every stored mandate in one admin request. Each `/mandate/:proxy` call is a Durable Object request
 * against the same daily cap as the keeper alarm, and the pool is re-checked every ops run.
 * Falls back to per-account reads on a worker without `/admin/mandates`.
 */
export async function mandateLookup(
  base: string,
  secret: string,
  fetcher: typeof fetch = fetch,
): Promise<(proxy: Address) => Promise<Response>> {
  const single = (proxy: Address) => fetcher(`${base}/mandate/${proxy}`);
  let response: Response;
  try {
    response = await fetcher(`${base}/admin/mandates`, { headers: { "x-admin-secret": secret } });
  } catch {
    return single;
  }
  if (!response.ok) return single;
  const body = (await response.json()) as { mandates?: (StoredMandate & { proxy?: string })[] };
  const byProxy = new Map<string, StoredMandate>();
  for (const row of body.mandates ?? []) if (row.proxy) byProxy.set(getAddress(row.proxy), row);
  return async (proxy) => {
    const stored = byProxy.get(getAddress(proxy));
    return stored ? Response.json(stored) : Response.json({ error: "not found" }, { status: 404 });
  };
}

export async function poolRegister(root = workspaceRoot(), argv: readonly string[] = []): Promise<number> {
  const secret = adminSecret(root);
  if (!secret) {
    console.error("ADMIN_SECRET missing");
    return 1;
  }
  const base = (option(argv, "--url") ?? DEFAULT_WORKER_URL).replace(/\/$/, "");
  const planned = planEntries(
    readJson<PoolFile>(path.join(root, "cli-state", "pool.json")),
    readJson<TwinsFile>(path.join(root, "cli-state", "twins.json")),
  );
  const client = testnetPublicClient();
  const poolOwner = loadRoles(root).POOL_OWNER.address;
  const before = argv.includes("--restore-twins") ? await mandateLookup(base, secret) : null;
  const entries = [];
  for (const entry of planned) {
    const accountId = await accountIdOf(client, entry.proxy);
    const [owner, pending] = await Promise.all([
      client.readContract({ address: entry.proxy, abi: delegatedAccountAbi, functionName: "owner" }),
      client.readContract({ address: entry.proxy, abi: delegatedAccountAbi, functionName: "pendingOwner" }),
    ]);
    const reopen =
      entry.role === "pool" &&
      getAddress(owner) === poolOwner &&
      getAddress(pending) === "0x0000000000000000000000000000000000000000";
    let replaceMandate = false;
    if (before && entry.role === "twin-protected") {
      const existing = await before(entry.proxy);
      if (existing.ok) {
        const stored = (await existing.json()) as { kind?: string };
        replaceMandate = stored.kind === "user";
      }
    }
    entries.push({ ...entry, accountId, reopen, replaceMandate });
  }
  const response = await fetch(`${base}/admin/pool`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-secret": secret },
    body: JSON.stringify({ entries }),
  });
  const body = (await response.json()) as { registered?: number; mandates?: number; error?: string };
  if (!response.ok) {
    console.error(`register failed ${response.status} ${body.error ?? ""}`.trim());
    return 1;
  }
  if (body.registered == null || body.registered < entries.length) {
    console.error(`register count registered=${body.registered ?? "none"} file=${entries.length}`);
    return 1;
  }
  console.log(`registered ${body.registered} file ${entries.length} mandates ${body.mandates ?? 0}`);
  const owner = loadRoles(root).POOL_OWNER.address;
  const lookup = await mandateLookup(base, secret);
  for (const entry of entries) {
    const mandate = await lookup(entry.proxy);
    if (entry.role === "twin-unprotected") {
      if (mandate.status !== 404) {
        console.error(`${entry.proxy} unprotected status=${mandate.status}`);
        return 1;
      }
      console.log(`${entry.proxy} ${entry.role} 404`);
      continue;
    }
    const stored = (await mandate.json()) as StoredMandate & { error?: string };
    if (!mandate.ok) {
      console.error(`${entry.proxy} mandate ${mandate.status} ${stored.error ?? ""}`.trim());
      return 1;
    }
    const message = buildMandate({
      account: getAddress(stored.typedData.account),
      perpIds: stored.typedData.perpIds.map((id) => BigInt(id)),
      triggerBps: stored.typedData.triggerBps,
      targetBps: stored.typedData.targetBps,
      maxPerActionCNS: BigInt(stored.typedData.maxPerActionCNS),
      budgetCNS: BigInt(stored.typedData.budgetCNS),
      expiry: BigInt(stored.typedData.expiry),
      nonce: BigInt(stored.typedData.nonce),
    });
    const recovered = await recoverSigner(message, stored.sig);
    const onchain = getAddress(
      await client.readContract({ address: entry.proxy, abi: delegatedAccountAbi, functionName: "owner" }),
    );
    if (onchain !== owner) {
      const houseKept = stored.kind === "house" && recovered === owner && getAddress(stored.owner) === owner;
      const userTook = stored.kind !== "house" && recovered === onchain && getAddress(stored.owner) === onchain;
      if (!houseKept && !userTook) {
        console.error(`${entry.proxy} claimed mandate mismatch`);
        return 1;
      }
      console.log(`${entry.proxy} ${entry.role} claimed owner=${onchain} kind=${stored.kind}`);
      continue;
    }
    if (
      (stored.kind === "user" || stored.kind === "sandbox") &&
      recovered === owner &&
      getAddress(stored.owner) === owner &&
      onchain === owner
    ) {
      console.log(`${entry.proxy} ${entry.role} house-signed kind=${stored.kind}`);
      continue;
    }
    const trigger = entry.role === "pool" || entry.role === "sandbox" ? 150 : 400;
    const target = entry.role === "pool" || entry.role === "sandbox" ? 250 : 600;
    if (
      recovered !== owner ||
      getAddress(stored.owner) !== owner ||
      stored.kind !== "house" ||
      stored.typedData.triggerBps !== trigger ||
      stored.typedData.targetBps !== target ||
      stored.typedData.budgetCNS !== "300000000"
    ) {
      console.error(`${entry.proxy} mandate mismatch`);
      return 1;
    }
    console.log(`${entry.proxy} ${entry.role} trigger=${trigger} target=${target} signer=${recovered}`);
  }
  return 0;
}

async function accountIdOf(client: PublicClient, proxy: Address): Promise<string> {
  const id = await client.readContract({ address: proxy, abi: delegatedAccountAbi, functionName: "accountId" });
  if (id === 0n) throw new Error(`${proxy} has no account id`);
  return id.toString();
}
