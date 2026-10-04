import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { erc20Abi } from "@lifeline/core";
import type { Address } from "viem";
import { workspaceRoot } from "./keys-generate.js";
import {
  ALL_ROLES,
  floorBreaches,
  formatUnits,
  targetShortfalls,
  type Holdings,
  type Role,
} from "../funding.js";
import { loadRoles } from "../roles.js";
import { testnetContracts, testnetPublicClient } from "../testnet.js";

function countJsonArray(file: string): number {
  if (!existsSync(file)) return 0;
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (Array.isArray(parsed)) return parsed.length;
  if (parsed && typeof parsed === "object") return Object.keys(parsed).length;
  return 0;
}

export async function status(root = workspaceRoot()): Promise<number> {
  const roles = loadRoles(root);
  const client = testnetPublicClient();
  const { ausd } = testnetContracts();
  const mon = {} as Record<Role, bigint>;
  const ausdBal = {} as Record<Role, bigint>;

  for (const role of ALL_ROLES) {
    const address = roles[role].address;
    mon[role] = await client.getBalance({ address });
    ausdBal[role] = await client.readContract({
      address: ausd,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as Address],
    });
    console.log(
      `${role} ${address} MON=${formatUnits(mon[role], 18, 4)} AUSD=${formatUnits(ausdBal[role], 6, 2)}`,
    );
  }

  const pool = countJsonArray(path.join(root, "cli-state", "pool.json"));
  const twins = countJsonArray(path.join(root, "cli-state", "twins.json"));
  console.log(`pool=${pool}`);
  console.log(`twins=${twins}`);

  const holdings: Holdings = { mon, ausd: ausdBal };
  const lows = floorBreaches(holdings);
  const shorts = targetShortfalls(holdings);
  for (const line of lows) console.log(line);
  for (const line of shorts) {
    const parts = line.split(" ");
    const role = parts[1];
    const asset = parts[2];
    const alreadyLow = lows.some((low) => low.startsWith(`LOW: ${role} ${asset} `));
    if (!alreadyLow) console.log(line);
  }
  if (lows.length > 0 || shorts.length > 0) return 1;
  return 0;
}
