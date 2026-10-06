import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildMandate, mandateDomain, mandateTypes, type MandateMessage } from "@lifeline/core";

/** 150 AUSD, the user per-action cap from PRD §F5. */
export const HOUSE_MAX_PER_ACTION_CNS = 150_000_000n;
/** 300 AUSD, the idle balance left on a pool account and the twin budget from PRD §F8. */
export const HOUSE_BUDGET_CNS = 300_000_000n;
/** One day inside the 30-day mandate expiry cap. */
export const HOUSE_EXPIRY_SEC = 29n * 24n * 60n * 60n;

export type PoolRole = "pool" | "twin-protected" | "twin-unprotected";

export interface PoolRegistration {
  proxy: Address;
  accountId: string;
  perpId: string;
  side: "long" | "short";
  leverage: string;
  market: string;
  role: PoolRole;
  pairId: string;
}

const ROLES = new Set<PoolRole>(["pool", "twin-protected", "twin-unprotected"]);

export function poolStatus(role: PoolRole): "available" | "twin" | "unprotected" {
  if (role === "pool") return "available";
  if (role === "twin-protected") return "twin";
  return "unprotected";
}

export function houseTerms(role: PoolRole): { triggerBps: number; targetBps: number } | null {
  if (role === "pool") return { triggerBps: 150, targetBps: 250 };
  if (role === "twin-protected") return { triggerBps: 400, targetBps: 600 };
  return null;
}

export function houseMandate(input: {
  account: Address;
  perpId: bigint;
  role: PoolRole;
  nowSec: bigint;
}): MandateMessage | null {
  const terms = houseTerms(input.role);
  if (!terms) return null;
  return buildMandate({
    account: input.account,
    perpIds: [input.perpId],
    triggerBps: terms.triggerBps,
    targetBps: terms.targetBps,
    maxPerActionCNS: HOUSE_MAX_PER_ACTION_CNS,
    budgetCNS: HOUSE_BUDGET_CNS,
    expiry: input.nowSec + HOUSE_EXPIRY_SEC,
    nonce: 0n,
  });
}

export async function signMandate(
  privateKey: string,
  message: MandateMessage,
): Promise<{ owner: Address; sig: Hex }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("pool owner key missing");
  const account = privateKeyToAccount(privateKey as Hex);
  const sig = await account.signTypedData({
    domain: mandateDomain(),
    types: mandateTypes,
    primaryType: "Mandate",
    message,
  });
  return { owner: account.address, sig };
}

/** A disarmed mandate (active 0) stays off. A missing or still-active mandate can take a breach. */
export function breachMayReplace(active: number | null): boolean {
  return active === null || active === 1;
}

/** Trigger sits above the current distance so the next keeper tick must top up. */
export function breachTerms(distanceE6: bigint): { triggerBps: number; targetBps: number } {
  const current = Number(distanceE6 / 100n);
  let trigger = current + 50;
  if (trigger < 1) trigger = 1;
  if (trigger > 1800) trigger = 1800;
  let target = trigger + 200;
  if (target > 2000) target = 2000;
  if (target <= trigger) trigger = target - 1;
  return { triggerBps: trigger, targetBps: target };
}

export function serializeMandate(message: MandateMessage): string {
  return JSON.stringify({
    account: message.account,
    perpIds: message.perpIds.map((id) => id.toString()),
    triggerBps: message.triggerBps,
    targetBps: message.targetBps,
    maxPerActionCNS: message.maxPerActionCNS.toString(),
    budgetCNS: message.budgetCNS.toString(),
    expiry: message.expiry.toString(),
    nonce: message.nonce.toString(),
  });
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(label);
  return value;
}

export function parseRegistrations(body: unknown): PoolRegistration[] {
  if (!body || typeof body !== "object" || !("entries" in body) || !Array.isArray(body.entries)) {
    throw new Error("entries required");
  }
  return body.entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`entry ${index} invalid`);
    const row = entry as Record<string, unknown>;
    const role = text(row.role, `entry ${index} role`);
    if (!ROLES.has(role as PoolRole)) throw new Error(`entry ${index} role`);
    const side = text(row.side, `entry ${index} side`);
    if (side !== "long" && side !== "short") throw new Error(`entry ${index} side`);
    const accountId = text(row.accountId, `entry ${index} accountId`);
    const perpId = text(row.perpId, `entry ${index} perpId`);
    const leverage = text(row.leverage, `entry ${index} leverage`);
    if (!/^\d+$/.test(accountId) || !/^\d+$/.test(perpId) || !/^\d+$/.test(leverage)) {
      throw new Error(`entry ${index} number`);
    }
    let proxy: Address;
    try {
      proxy = getAddress(text(row.proxy, `entry ${index} proxy`));
    } catch {
      throw new Error(`entry ${index} proxy`);
    }
    return {
      proxy,
      accountId,
      perpId,
      side,
      leverage,
      market: text(row.market, `entry ${index} market`),
      role: role as PoolRole,
      pairId: typeof row.pairId === "string" ? row.pairId : "",
    };
  });
}
