import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GAS_LIMITS } from "@lifeline/core";
import { formatEther, type Hex } from "viem";
import { workspaceRoot } from "./keys-generate.js";
import {
  MON_ROLES,
  formatUnits,
  planMonSends,
  type MonRole,
} from "../funding.js";
import { loadRoles } from "../roles.js";
import { testnetPublicClient, testnetWallet } from "../testnet.js";

interface PendingSend {
  role: MonRole;
  amount: string;
  nonce: string;
  hash: string | null;
}

interface Checkpoint {
  pending: PendingSend | null;
}

function gasLimit(): bigint {
  const gas = GAS_LIMITS.monDrip;
  if (gas === undefined) throw new Error("missing gas limit monDrip");
  return gas;
}

function checkpointPath(root: string): string {
  return path.join(root, "cli-state", "fund-mon.json");
}

function loadCheckpoint(root: string): Checkpoint {
  try {
    return JSON.parse(readFileSync(checkpointPath(root), "utf8")) as Checkpoint;
  } catch {
    return { pending: null };
  }
}

function saveCheckpoint(root: string, state: Checkpoint) {
  const file = checkpointPath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

function flag(argv: readonly string[], name: string): boolean {
  return argv.includes(name);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fundMon(root = workspaceRoot(), argv: readonly string[] = []): Promise<number> {
  const roles = loadRoles(root);
  const client = testnetPublicClient();
  const sponsor = roles.SPONSOR;
  const wallet = testnetWallet(sponsor);
  const gas = gasLimit();
  const fees = await client.estimateFeesPerGas();
  const maxFee = fees.maxFeePerGas ?? 0n;
  const gasCost = gas * maxFee;
  console.log(`fund:mon gasLimit=${gas} maxFeePerGas=${maxFee} reserveMON=${formatUnits(gasCost, 18, 6)}`);

  const settled = await settlePending(root, client, sponsor.address);
  if (!settled) return 1;

  const balances = {} as Record<MonRole, bigint>;
  for (const role of MON_ROLES) {
    balances[role] = await client.getBalance({ address: roles[role].address });
  }
  const sponsorBalance = await client.getBalance({ address: sponsor.address });
  const sends = planMonSends({ sponsor: sponsorBalance, balances, gasCost });
  if (sends.length === 0) {
    console.log("fund:mon nothing to send");
    return 0;
  }

  const killAfterBroadcast = flag(argv, "--kill-after-broadcast");
  for (const send of sends) {
    const nonce = await client.getTransactionCount({ address: sponsor.address, blockTag: "pending" });
    const pending: PendingSend = {
      role: send.role,
      amount: send.amount.toString(),
      nonce: nonce.toString(),
      hash: null,
    };
    saveCheckpoint(root, { pending });
    const hash = await wallet.sendTransaction({
      account: sponsor,
      chain: wallet.chain,
      to: roles[send.role].address,
      value: send.amount,
      gas,
      nonce,
    });
    pending.hash = hash;
    saveCheckpoint(root, { pending });
    console.log(`${send.role} +${formatEther(send.amount)} MON tx ${hash} broadcast`);
    if (killAfterBroadcast) {
      console.log("fund:mon killed after broadcast");
      return 0;
    }
    const receipt = await client.waitForTransactionReceipt({ hash });
    const status = receipt.status === "success" ? 1 : 0;
    console.log(`${send.role} tx ${hash} status=${status} gas=${receipt.gasUsed}`);
    saveCheckpoint(root, { pending: null });
    if (status !== 1) return 1;
  }
  return 0;
}

async function settlePending(
  root: string,
  client: ReturnType<typeof testnetPublicClient>,
  sponsor: `0x${string}`,
): Promise<boolean> {
  const pending = loadCheckpoint(root).pending;
  if (!pending) return true;
  if (pending.hash) {
    const receipt = await client.waitForTransactionReceipt({ hash: pending.hash as Hex });
    const status = receipt.status === "success" ? 1 : 0;
    console.log(`fund:mon resume ${pending.role} tx ${pending.hash} status=${status} gas=${receipt.gasUsed}`);
    saveCheckpoint(root, { pending: null });
    return status === 1;
  }
  const nonce = BigInt(pending.nonce);
  const latest = await client.getTransactionCount({ address: sponsor, blockTag: "latest" });
  const mempool = await client.getTransactionCount({ address: sponsor, blockTag: "pending" });
  if (latest > nonce) {
    console.log(`fund:mon resume ${pending.role} nonce ${nonce} already mined`);
    saveCheckpoint(root, { pending: null });
    return true;
  }
  if (mempool > nonce) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(2_000);
      const now = await client.getTransactionCount({ address: sponsor, blockTag: "latest" });
      if (now > nonce) {
        console.log(`fund:mon resume ${pending.role} nonce ${nonce} mined`);
        saveCheckpoint(root, { pending: null });
        return true;
      }
    }
    console.error(`fund:mon in-flight ${pending.role} did not mine`);
    return false;
  }
  console.log(`fund:mon drop unsent ${pending.role}`);
  saveCheckpoint(root, { pending: null });
  return true;
}
