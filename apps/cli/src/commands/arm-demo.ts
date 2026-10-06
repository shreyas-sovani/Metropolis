import { armDefaults, buildMandate, mandateDomain, mandateTypes, acceptOwnershipTx } from "@lifeline/core";
import { getAddress } from "viem";
import { loadRoles } from "../roles.js";
import { testnetPublicClient, testnetWallet } from "../testnet.js";
import {
  adminSecret,
  distanceE6Of,
  distanceInTargetBand,
  headersFor,
  jsonMandate,
} from "./arm-trial.js";
import { workspaceRoot } from "./keys-generate.js";
import { DEFAULT_WORKER_URL } from "./pool-register.js";

const CAP_CNS = 150_000_000n;

interface ClaimBody {
  proxy?: string;
  perpId?: string;
  error?: string;
  position?: { distanceE6?: string };
  txs?: { drip?: string; transfer?: string };
}

interface ArmBody {
  txHash?: string;
  msFromRequest?: number;
  reason?: string;
  error?: string;
  skipped?: boolean;
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function armDemo(root = workspaceRoot(), argv: readonly string[] = []): Promise<number> {
  const secret = adminSecret(root);
  if (!secret) {
    console.error("ADMIN_SECRET missing");
    return 1;
  }
  const count = Number(option(argv, "--count") ?? "20");
  if (!Number.isInteger(count) || count < 1) {
    console.error("usage: arm:demo --count 20");
    return 1;
  }
  const base = (option(argv, "--url") ?? DEFAULT_WORKER_URL).replace(/\/$/, "");
  const roles = loadRoles(root);
  const owner = roles.TEST_OWNER;
  const client = testnetPublicClient();
  let confirmed = 0;
  for (let index = 0; index < count; index += 1) {
    const user = `did:privy:u3-${Date.now()}-${index}`;
    const ip = `198.51.100.${index + 1}`;
    let claimed: Response | null = null;
    let claim: ClaimBody = {};
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      claimed = await fetch(`${base}/claim`, {
        method: "POST",
        headers: await headersFor(owner, secret, user, `u3-claim-${index}`, ip),
      });
      claim = (await claimed.json()) as ClaimBody;
      if (claimed.ok && claim.proxy && claim.perpId) break;
      if (claimed.status !== 500 || attempt === 4) {
        console.error(`claim ${index} ${claimed.status} ${JSON.stringify(claim)}`);
        return 1;
      }
      console.log(`claim ${index} retry ${attempt}`);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    if (!claimed || !claim.proxy || !claim.perpId) return 1;
    for (const hash of [claim.txs?.drip, claim.txs?.transfer]) {
      if (!hash) continue;
      const receipt = await client.waitForTransactionReceipt({ hash: hash as `0x${string}`, pollingInterval: 400, timeout: 30_000 });
      if (receipt.status !== "success") {
        console.error(`claim ${index} tx ${hash} reverted`);
        return 1;
      }
    }
    const proxy = getAddress(claim.proxy);
    const wallet = testnetWallet(owner);
    const built = acceptOwnershipTx(proxy);
    const nonce = await client.getTransactionCount({ address: owner.address, blockTag: "pending" });
    const acceptHash = await wallet.sendTransaction({
      account: owner,
      chain: wallet.chain,
      to: built.to,
      data: built.data,
      gas: built.gas,
      nonce,
      value: 0n,
    });
    const accepted = await client.waitForTransactionReceipt({ hash: acceptHash, pollingInterval: 200 });
    if (accepted.status !== "success") {
      console.error(`accept ${proxy} failed`);
      return 1;
    }
    const perpId = BigInt(claim.perpId);
    const distance = await distanceE6Of(client, proxy, perpId);
    const terms = armDefaults(distance);
    const message = buildMandate({
      account: proxy,
      perpIds: [perpId],
      triggerBps: terms.triggerBps,
      targetBps: terms.targetBps,
      maxPerActionCNS: CAP_CNS,
      budgetCNS: CAP_CNS,
      expiry: BigInt(Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60),
      nonce: 1n,
    });
    const signature = await owner.signTypedData({
      domain: mandateDomain(),
      types: mandateTypes,
      primaryType: "Mandate",
      message,
    });
    const armed = await fetch(`${base}/arm`, {
      method: "POST",
      headers: await headersFor(owner, secret, user, `u3-arm-${index}`, ip),
      body: JSON.stringify({ mandate: jsonMandate(message), signature }),
    });
    const body = (await armed.json()) as ArmBody;
    let after = 0n;
    if (!armed.ok || !body.txHash) {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      after = await distanceE6Of(client, proxy, perpId);
      const landed = distanceInTargetBand(after, terms.targetBps);
      if (!landed) {
        console.error(`arm ${proxy} ${armed.status} ${JSON.stringify(body)} dist=${distance} chainDist=${after} terms=${terms.triggerBps}/${terms.targetBps}`);
        return 1;
      }
      console.log(`cycle ${index + 1} ${proxy} dist=${distance} trigger=${terms.triggerBps} target=${terms.targetBps} chainDist=${after} recovered`);
      confirmed += 1;
      continue;
    }
    after = await distanceE6Of(client, proxy, perpId);
    const band = distanceInTargetBand(after, terms.targetBps) || body.reason === "capped";
    console.log(
      `cycle ${index + 1} ${proxy} dist=${distance} trigger=${terms.triggerBps} target=${terms.targetBps} tx=${body.txHash} chainDist=${after} reason=${body.reason ?? ""}`,
    );
    if (!band) {
      console.error(`${proxy} distance ${after} outside the band for target ${terms.targetBps}`);
      return 1;
    }
    confirmed += 1;
  }
  console.log(`confirmed ${confirmed}/${count}`);
  return confirmed === count ? 0 : 1;
}
