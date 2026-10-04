import { readFileSync } from "node:fs";
import path from "node:path";
import { createPublicKey, verify as verifySignature } from "node:crypto";
import {
  ADDRESSES,
  GAS_LIMITS,
  TESTNET_ID,
  assignOperatorTypes,
  delegatedAccountAbi,
  delegatedAccountFactoryAbi,
  factoryDomain,
  mandateDomain,
  mandateMessage,
  mandateTypes,
} from "@lifeline/core";
import { decodeEventLog, getAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { loadRoles } from "../roles.js";
import { sendContract } from "../send.js";
import { testnetPublicClient, testnetWallet } from "../testnet.js";
import { workspaceRoot } from "./keys-generate.js";

const DRIP = 8n * 10n ** 16n;
const SPONSOR_FLOOR = 3n * 10n ** 18n;

function servicesValue(root: string, name: string): string {
  const file = path.join(root, "secrets", "services.env");
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).trim();
  }
  throw new Error(`${name} missing`);
}

export function verifyAccessToken(token: string, spkiBase64: string): boolean {
  const pem = `-----BEGIN PUBLIC KEY-----\n${spkiBase64}\n-----END PUBLIC KEY-----\n`;
  const key = createPublicKey(pem);
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return false;
  return verifySignature(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    { key, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url"),
  );
}

async function handoff(guest: Address, root: string): Promise<number> {
  const roles = loadRoles(root);
  const client = testnetPublicClient();
  const factory = ADDRESSES[TESTNET_ID].factory;
  if (!factory) throw new Error("factory missing");
  const owner = roles.POOL_OWNER;
  const operator = roles.OPERATOR;
  const sponsor = roles.SPONSOR;
  const balance = await client.getBalance({ address: sponsor.address });
  if (balance < SPONSOR_FLOOR + DRIP) {
    console.error("sponsor would breach the 3 MON floor");
    return 1;
  }
  const sponsorWallet = testnetWallet(sponsor);
  const dripHash = await sponsorWallet.sendTransaction({
    account: sponsor,
    chain: sponsorWallet.chain,
    to: guest,
    value: DRIP,
    gas: GAS_LIMITS.monDrip,
  });
  const drip = await client.waitForTransactionReceipt({ hash: dripHash });
  console.log(`mon.drip tx ${dripHash} status=${drip.status === "success" ? 1 : 0} gas=${drip.gasUsed}`);
  if (drip.status !== "success") return 1;

  const nonce = (await client.readContract({
    address: factory,
    abi: delegatedAccountFactoryAbi,
    functionName: "operatorNonces",
    args: [operator.address],
  })) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await operator.signTypedData({
    domain: factoryDomain(factory, TESTNET_ID),
    types: assignOperatorTypes,
    primaryType: "AssignOperator",
    message: { owner: owner.address, nonce, deadline },
  });
  const created = await sendContract({
    client,
    wallet: testnetWallet(owner),
    account: owner,
    address: factory,
    abi: delegatedAccountFactoryAbi,
    functionName: "create",
    args: [operator.address, deadline, signature],
    kind: "factory.create",
    gas: GAS_LIMITS.factoryCreate,
  });
  let proxy: Address | undefined;
  for (const log of created.receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: delegatedAccountFactoryAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "DelegatedAccountCreated") proxy = decoded.args.proxy;
    } catch {
      continue;
    }
  }
  if (!proxy) return 1;
  await sendContract({
    client,
    wallet: testnetWallet(owner),
    account: owner,
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "transferOwnership",
    args: [guest],
    kind: "transferOwnership",
    gas: GAS_LIMITS.transferOwnership,
  });
  console.log(`proxy ${proxy}`);
  return 0;
}

async function check(proxy: Address, guest: Address, signature: Hex, token: string, root: string) {
  const client = testnetPublicClient();
  const owner = (await client.readContract({
    address: proxy,
    abi: delegatedAccountAbi,
    functionName: "owner",
  })) as Address;
  const message = mandateMessage({ account: proxy, perpId: 16n });
  const recovered = await recoverTypedDataAddress({
    domain: mandateDomain(),
    types: mandateTypes,
    primaryType: "Mandate",
    message,
    signature,
  });
  const tokenOk = verifyAccessToken(token, servicesValue(root, "PRIVY_VERIFICATION_KEY"));
  const ownerOk = getAddress(owner) === getAddress(guest);
  const sigOk = getAddress(recovered) === getAddress(guest);
  console.log(`ownerOk=${ownerOk} sigOk=${sigOk} tokenOk=${tokenOk} owner=${owner}`);
  return ownerOk && sigOk && tokenOk ? 0 : 1;
}

export async function gate2(argv: readonly string[], root = workspaceRoot()): Promise<number> {
  const mode = argv[0];
  if (mode === "handoff" && argv[1]) return handoff(getAddress(argv[1]), root);
  if (mode === "check" && argv[1] && argv[2] && argv[3] && argv[4]) {
    return check(getAddress(argv[1]), getAddress(argv[2]), argv[3] as Hex, argv[4], root);
  }
  console.error("usage: gate:2 handoff <guest> | gate:2 check <proxy> <guest> <signature> <token>");
  return 1;
}
