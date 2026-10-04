import { readFileSync } from "node:fs";
import path from "node:path";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { workspaceRoot } from "./commands/keys-generate.js";
import { ALL_ROLES, type Role } from "./funding.js";

const KEY_BY_ROLE: Record<Role, string> = {
  SPONSOR: "SPONSOR_PK",
  OPERATOR: "OPERATOR_PK",
  POOL_OWNER: "POOL_OWNER_PK",
  MAKER: "MAKER_PK",
  CALIBRATION: "CALIBRATION_PK",
  TEST_OWNER: "TEST_OWNER_PK",
};

export function loadRoles(root = workspaceRoot()): Record<Role, PrivateKeyAccount> {
  const file = path.join(root, "secrets", "testnet-keys.env");
  const values = new Map<string, string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const split = line.indexOf("=");
    if (split <= 0 || line.startsWith("#")) continue;
    values.set(line.slice(0, split), line.slice(split + 1).trim());
  }
  const roles = {} as Record<Role, PrivateKeyAccount>;
  for (const role of ALL_ROLES) {
    const key = values.get(KEY_BY_ROLE[role]);
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error(`${KEY_BY_ROLE[role]} missing`);
    }
    roles[role] = privateKeyToAccount(key as `0x${string}`);
  }
  return roles;
}

export function alchemyTestnetUrl(root = workspaceRoot()): string | undefined {
  const file = path.join(root, "secrets", "services.env");
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.startsWith("ALCHEMY_MONAD_TESTNET_URL=")) {
        const value = line.slice("ALCHEMY_MONAD_TESTNET_URL=".length).trim();
        return value || undefined;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}
