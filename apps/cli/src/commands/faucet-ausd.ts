import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GAS_LIMITS, erc20Abi, faucetAbi } from "@lifeline/core";
import {
  BaseError,
  ContractFunctionRevertedError,
  type Address,
} from "viem";
import { workspaceRoot } from "./keys-generate.js";
import {
  AUSD_ROLES,
  formatUnits,
  nextFaucetRole,
  type AusdRole,
} from "../funding.js";
import { loadRoles } from "../roles.js";
import { testnetContracts, testnetPublicClient, testnetWallet } from "../testnet.js";

function revertName(error: unknown): string | undefined {
  if (error instanceof BaseError) {
    const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName;
    if (error.shortMessage.includes("MaxFrequencyExceeded")) return "MaxFrequencyExceeded";
    if (error.shortMessage.includes("InsufficientFunds")) return "InsufficientFunds";
    if (error.shortMessage.includes("MaxAllowedExceeded")) return "MaxAllowedExceeded";
  }
  return undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

interface FaucetCheckpoint {
  pending: { role: AusdRole; hash: string | null } | null;
}

function faucetPath(root: string): string {
  return path.join(root, "cli-state", "faucet-ausd.json");
}

function loadFaucet(root: string): FaucetCheckpoint {
  try {
    return JSON.parse(readFileSync(faucetPath(root), "utf8")) as FaucetCheckpoint;
  } catch {
    return { pending: null };
  }
}

function saveFaucet(root: string, state: FaucetCheckpoint) {
  const file = faucetPath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

function faucetGas(): bigint {
  const gas = GAS_LIMITS.faucetRequestFunds;
  if (gas === undefined) throw new Error("missing gas limit faucetRequestFunds");
  return gas;
}

export async function faucetAusd(root = workspaceRoot(), argv: readonly string[] = []): Promise<number> {
  const roles = loadRoles(root);
  const client = testnetPublicClient();
  const wallet = testnetWallet(roles.SPONSOR);
  const { faucet, ausd } = testnetContracts();
  const [drip, maxOwn, frequency] = await Promise.all([
    client.readContract({ address: faucet, abi: faucetAbi, functionName: "faucetDripAmount" }),
    client.readContract({ address: faucet, abi: faucetAbi, functionName: "maxAmountToOwn" }),
    client.readContract({ address: faucet, abi: faucetAbi, functionName: "maxDripFrequency" }),
  ]);
  console.log(
    `faucet drip=${formatUnits(drip, 6, 2)} maxOwn=${formatUnits(maxOwn, 6, 2)} cooldown=${frequency}s`,
  );

  const balances = {} as Record<AusdRole, bigint>;
  for (const role of AUSD_ROLES) {
    balances[role] = await client.readContract({
      address: ausd,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [roles[role].address],
    });
  }

  const resumed = await settleFaucet(root, client);
  if (!resumed) return 1;
  if (loadFaucet(root).pending) {
    console.error("faucet:ausd still in flight");
    return 1;
  }

  let retries = 0;
  const killAfterBroadcast = argv.includes("--kill-after-broadcast");
  for (let step = 0; step < 20; step += 1) {
    const next = nextFaucetRole(balances, null);
    if (!next) {
      console.log("faucet:ausd targets met");
      return 0;
    }
    if (balances[next] + drip > maxOwn) {
      console.error(`faucet ${next} would exceed maxAmountToOwn`);
      return 1;
    }

    const ready = await waitForCooldown(client, faucet, frequency);
    if (!ready) return 1;

    const outcome = await requestOnce(client, wallet, faucet, roles[next].address, root, next, killAfterBroadcast);
    if (outcome === "killed") return 0;
    if (outcome === "retry") {
      retries += 1;
      if (retries > 5) return 1;
      step -= 1;
      continue;
    }
    retries = 0;
    if (outcome === "stop") return 1;

    balances[next] = await client.readContract({
      address: ausd,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [roles[next].address],
    });
    console.log(`${next} AUSD=${formatUnits(balances[next], 6, 2)}`);
  }

  console.error("faucet:ausd stopped after 20 attempts");
  return 1;
}

async function waitForCooldown(
  client: ReturnType<typeof testnetPublicClient>,
  faucet: Address,
  frequency: bigint,
): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const last = await client.readContract({
      address: faucet,
      abi: faucetAbi,
      functionName: "lastDripTimestamp",
    });
    const block = await client.getBlock();
    const readyAt = last + frequency;
    if (block.timestamp >= readyAt) return true;
    const waitMs = Number(readyAt - block.timestamp) * 1000 + 1500;
    console.log(`faucet cooldown ${Number(readyAt - block.timestamp)}s`);
    await sleep(waitMs);
  }
  console.error("faucet cooldown did not clear");
  return false;
}

async function settleFaucet(
  root: string,
  client: ReturnType<typeof testnetPublicClient>,
): Promise<boolean> {
  const pending = loadFaucet(root).pending;
  if (!pending?.hash) {
    if (pending) saveFaucet(root, { pending: null });
    return true;
  }
  const receipt = await client.waitForTransactionReceipt({ hash: pending.hash as `0x${string}` });
  const status = receipt.status === "success" ? 1 : 0;
  console.log(`faucet resume ${pending.role} tx ${pending.hash} status=${status} gas=${receipt.gasUsed}`);
  saveFaucet(root, { pending: null });
  return status === 1;
}

async function requestOnce(
  client: ReturnType<typeof testnetPublicClient>,
  wallet: ReturnType<typeof testnetWallet>,
  faucet: Address,
  receiver: Address,
  root: string,
  role: AusdRole,
  killAfterBroadcast: boolean,
): Promise<"ok" | "retry" | "stop" | "killed"> {
  try {
    const gas = faucetGas();
    saveFaucet(root, { pending: { role, hash: null } });
    const hash = await wallet.writeContract({
      address: faucet,
      abi: faucetAbi,
      functionName: "requestFunds",
      args: [receiver],
      account: wallet.account ?? null,
      chain: wallet.chain,
      gas,
    });
    saveFaucet(root, { pending: { role, hash } });
    console.log(`faucet requestFunds tx ${hash} broadcast gasLimit=${gas}`);
    if (killAfterBroadcast) {
      console.log("faucet:ausd killed after broadcast");
      return "killed";
    }
    const receipt = await client.waitForTransactionReceipt({ hash });
    saveFaucet(root, { pending: null });
    const status = receipt.status === "success" ? 1 : 0;
    console.log(`faucet requestFunds tx ${hash} status=${status} gasLimit=${gas}`);
    if (status !== 1) return "stop";
    return "ok";
  } catch (error) {
    const name = revertName(error);
    if (name === "MaxFrequencyExceeded") {
      console.log("faucet MaxFrequencyExceeded, backing off");
      await sleep(Number(await readFrequency(client, faucet)) * 1000 + 1500);
      return "retry";
    }
    if (name === "InsufficientFunds") {
      console.error("faucet InsufficientFunds");
      return "stop";
    }
    const message = error instanceof BaseError ? error.shortMessage : "faucet request failed";
    console.error(message);
    return "stop";
  }
}

async function readFrequency(
  client: ReturnType<typeof testnetPublicClient>,
  faucet: Address,
): Promise<bigint> {
  return client.readContract({
    address: faucet,
    abi: faucetAbi,
    functionName: "maxDripFrequency",
  });
}
