import { formatEther } from "viem";
import { workspaceRoot } from "./keys-generate.js";
import {
  MON_ROLES,
  bumpedGas,
  formatUnits,
  planMonSends,
  type MonRole,
} from "../funding.js";
import { loadRoles } from "../roles.js";
import { testnetPublicClient, testnetWallet } from "../testnet.js";

export async function fundMon(root = workspaceRoot()): Promise<number> {
  const roles = loadRoles(root);
  const client = testnetPublicClient();
  const sponsor = roles.SPONSOR;
  const wallet = testnetWallet(sponsor);
  const balances = {} as Record<MonRole, bigint>;
  for (const role of MON_ROLES) {
    balances[role] = await client.getBalance({ address: roles[role].address });
  }
  const sponsorBalance = await client.getBalance({ address: sponsor.address });
  const probe = await client.estimateGas({
    account: sponsor.address,
    to: roles.OPERATOR.address,
    value: 1n,
  });
  const gas = bumpedGas(probe);
  const fees = await client.estimateFeesPerGas();
  const maxFee = fees.maxFeePerGas ?? 0n;
  const gasCost = gas * maxFee;
  console.log(
    `fund:mon gasLimit=${gas} maxFeePerGas=${maxFee} reserveMON=${formatUnits(gasCost, 18, 6)}`,
  );

  const sends = planMonSends({
    sponsor: sponsorBalance,
    balances,
    gasCost,
  });
  if (sends.length === 0) {
    console.log("fund:mon nothing to send");
    return 0;
  }

  for (const send of sends) {
    const hash = await wallet.sendTransaction({
      account: sponsor,
      chain: wallet.chain,
      to: roles[send.role].address,
      value: send.amount,
      gas,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    const status = receipt.status === "success" ? 1 : 0;
    console.log(
      `${send.role} +${formatEther(send.amount)} MON tx ${hash} status=${status}`,
    );
    if (status !== 1) return 1;
  }
  return 0;
}
