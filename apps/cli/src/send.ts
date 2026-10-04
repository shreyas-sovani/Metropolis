import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type Abi,
  type Account,
  type Address,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { bumpedGas } from "./funding.js";
import { workspaceRoot } from "./commands/keys-generate.js";

export interface GasEntry {
  kind: string;
  hash: string;
  gasUsed: string;
  status: number;
}

export async function sendContract(args: {
  client: PublicClient;
  wallet: WalletClient;
  account: Account;
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  kind: string;
  value?: bigint;
}): Promise<{ hash: `0x${string}`; gasUsed: bigint; status: number; receipt: TransactionReceipt }> {
  const gas = bumpedGas(
    await args.client.estimateContractGas({
      account: args.account,
      address: args.address,
      abi: args.abi,
      functionName: args.functionName,
      args: args.args,
      value: args.value,
    } as never),
  );
  const hash = await args.wallet.writeContract({
    account: args.account,
    chain: args.wallet.chain,
    address: args.address,
    abi: args.abi,
    functionName: args.functionName,
    args: args.args,
    gas,
    value: args.value,
  } as never);
  const receipt = await args.client.waitForTransactionReceipt({ hash });
  const status = receipt.status === "success" ? 1 : 0;
  console.log(`${args.kind} tx ${hash} status=${status} gas=${receipt.gasUsed}`);
  appendGas(args.kind, hash, receipt.gasUsed, status);
  if (status !== 1) throw new Error(`${args.kind} reverted ${hash}`);
  return { hash, gasUsed: receipt.gasUsed, status, receipt };
}

function appendGas(kind: string, hash: string, gasUsed: bigint, status: number, root = workspaceRoot()) {
  const dir = path.join(root, "cli-state");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "gas-log.json");
  let entries: GasEntry[] = [];
  try {
    entries = JSON.parse(readFileSync(file, "utf8")).entries as GasEntry[];
  } catch {
    entries = [];
  }
  entries.push({ kind, hash, gasUsed: gasUsed.toString(), status });
  writeFileSync(file, `${JSON.stringify({ entries }, null, 2)}\n`);
}
