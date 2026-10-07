import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ADDRESSES,
  CHAINS,
  TESTNET_ID,
  buildMandate,
  contractDistanceE6,
  erc20Abi,
  exchangeAbi,
  mandateDomain,
  mandateTypes,
  readAccountByAddr,
  readPositionsForAccount,
  rpcUrls,
  type MandateMessage,
} from "@lifeline/core";
import {
  createPublicClient,
  createWalletClient,
  fallback,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { disarmText } from "./try-flow";
import { workerOrigin } from "./http";

/** Present only in an E2E_WALLET=test build. A production bundle must not contain this string. */
export const E2E_ADAPTER_MARKER = "LIFELINE_TEST_WALLET_ADAPTER";

interface ActBody {
  op?: string;
  userId?: string;
  nonce?: string;
  to?: string;
  data?: string;
  gas?: string;
  mandate?: {
    account?: string;
    perpIds?: string[];
    triggerBps?: number;
    targetBps?: number;
    maxPerActionCNS?: string;
    budgetCNS?: string;
    expiry?: string;
    nonce?: string;
  };
  proxy?: string;
  perpId?: string;
  turnstileToken?: string;
}

function repoRoot(): string {
  let dir = process.cwd();
  for (let hop = 0; hop < 5; hop += 1) {
    if (existsSync(path.join(dir, "secrets", "testnet-keys.env"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("secrets");
}

function envValue(file: string, name: string): string {
  const text = readFileSync(path.join(repoRoot(), "secrets", file), "utf8");
  for (const line of text.split("\n")) {
    if (!line.startsWith(`${name}=`)) continue;
    return line.slice(name.length + 1).trim();
  }
  throw new Error(`${name} missing`);
}

function ownerAccount() {
  const key = envValue("testnet-keys.env", "TEST_OWNER_PK");
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("TEST_OWNER_PK missing");
  return privateKeyToAccount(key as Hex);
}

function clients() {
  const chain = CHAINS[TESTNET_ID];
  const urls = rpcUrls(TESTNET_ID);
  const transport = fallback(urls.map((url) => http(url, { timeout: 20_000, retryCount: 0 })));
  const account = ownerAccount();
  return {
    account,
    public: createPublicClient({ chain, transport }),
    wallet: createWalletClient({ account, chain, transport }),
  };
}

function maintHdths(value: unknown): bigint {
  if (Array.isArray(value) && typeof value[1] === "bigint") return value[1];
  if (value && typeof value === "object" && "perpMaintMarginFracHdths" in value) {
    const hdths = value.perpMaintMarginFracHdths;
    if (typeof hdths === "bigint") return hdths;
  }
  throw new Error("margin");
}

function proofMessage(userId: string, address: string, nonce: string): string {
  return `lifeline:${userId}:${address}:${nonce}`;
}

async function authHeaders(userId: string, nonce: string): Promise<Record<string, string>> {
  const account = ownerAccount();
  const signature = await account.signMessage({ message: proofMessage(userId, account.address, nonce) });
  const hash = [...userId].reduce((sum, char) => (sum * 33 + char.charCodeAt(0)) >>> 0, 0);
  return {
    "content-type": "application/json",
    "x-admin-secret": envValue("services.env", "ADMIN_SECRET"),
    "x-lifeline-user": userId,
    "x-lifeline-address": account.address,
    "x-lifeline-signature": signature,
    "x-lifeline-nonce": nonce,
    "x-lifeline-ip": `203.0.113.${(hash % 200) + 20}`,
  };
}

async function worker(path: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  const response = await fetch(`${workerOrigin()}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}

async function send(to: Address, data: Hex, gas: bigint): Promise<{ hash: Hex; nonce: number; status: string }> {
  const { account, public: client, wallet } = clients();
  const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
  const hash = await wallet.sendTransaction({
    account,
    chain: wallet.chain,
    to,
    data,
    gas,
    nonce,
    value: 0n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 400, timeout: 45_000 });
  return { hash, nonce, status: receipt.status };
}

function mandateFrom(body: ActBody["mandate"]): MandateMessage {
  if (!body?.account || !body.perpIds?.length) throw new Error("mandate");
  return buildMandate({
    account: getAddress(body.account),
    perpIds: body.perpIds.map((id) => BigInt(id)),
    triggerBps: Number(body.triggerBps),
    targetBps: Number(body.targetBps),
    maxPerActionCNS: BigInt(body.maxPerActionCNS ?? "0"),
    budgetCNS: BigInt(body.budgetCNS ?? "0"),
    expiry: BigInt(body.expiry ?? "0"),
    nonce: BigInt(body.nonce ?? "0"),
  });
}

export async function handleE2E(request: Request): Promise<Response> {
  if (process.env.E2E_WALLET !== "test") {
    return Response.json({ error: "e2e off" }, { status: 404 });
  }
  let body: ActBody;
  try {
    body = (await request.json()) as ActBody;
  } catch {
    return Response.json({ error: "json" }, { status: 400 });
  }
  try {
    if (body.op === "prepare") {
      return Response.json({ address: ownerAccount().address, marker: E2E_ADAPTER_MARKER });
    }
    if (body.op === "me") {
      if (!body.userId || !body.nonce) return Response.json({ error: "me" }, { status: 400 });
      const headers = await authHeaders(body.userId, body.nonce);
      const response = await fetch(`${workerOrigin()}/me`, { headers });
      const text = await response.text();
      return new Response(text, { status: response.status, headers: { "content-type": "application/json" } });
    }
    if (body.op === "claim") {
      if (!body.userId || !body.nonce) return Response.json({ error: "claim" }, { status: 400 });
      const headers = await authHeaders(body.userId, body.nonce);
      return worker("/claim", headers, { turnstileToken: body.turnstileToken ?? "" });
    }
    if (body.op === "send") {
      if (!body.to || !body.data || !body.gas) return Response.json({ error: "send" }, { status: 400 });
      const sent = await send(getAddress(body.to), body.data as Hex, BigInt(body.gas));
      return Response.json(sent);
    }
    if (body.op === "arm") {
      if (!body.userId || !body.nonce) return Response.json({ error: "arm" }, { status: 400 });
      const message = mandateFrom(body.mandate);
      const signature = await ownerAccount().signTypedData({
        domain: mandateDomain(),
        types: mandateTypes,
        primaryType: "Mandate",
        message,
      });
      const headers = await authHeaders(body.userId, body.nonce);
      return worker("/arm", headers, {
        mandate: {
          account: message.account,
          perpIds: message.perpIds.map((id) => id.toString()),
          triggerBps: message.triggerBps,
          targetBps: message.targetBps,
          maxPerActionCNS: message.maxPerActionCNS.toString(),
          budgetCNS: message.budgetCNS.toString(),
          expiry: message.expiry.toString(),
          nonce: message.nonce.toString(),
        },
        signature,
      });
    }
    if (body.op === "disarm") {
      if (!body.userId || !body.nonce || !body.proxy) return Response.json({ error: "disarm" }, { status: 400 });
      const proxy = getAddress(body.proxy);
      const signature = await ownerAccount().signMessage({ message: disarmText(proxy, body.nonce) });
      const headers = await authHeaders(body.userId, `${body.nonce}-proof`);
      return worker("/disarm", headers, { proxy, nonce: body.nonce, signature });
    }
    if (body.op === "distance") {
      if (!body.proxy || !body.perpId) return Response.json({ error: "distance" }, { status: 400 });
      const proxy = getAddress(body.proxy);
      const perpId = BigInt(body.perpId);
      const { public: client } = clients();
      const exchange = ADDRESSES[TESTNET_ID].exchange;
      const account = await readAccountByAddr(client, exchange, proxy);
      const positions = await readPositionsForAccount(client, exchange, account.accountId);
      const position = positions.find((item) => BigInt(item.perpId) === perpId);
      if (!position) return Response.json({ error: "position" }, { status: 404 });
      const packed = await client.multicall({
        contracts: [
          { address: exchange, abi: exchangeAbi, functionName: "getPerpetualInfoV2", args: [perpId] },
          { address: exchange, abi: exchangeAbi, functionName: "getMarginFractions", args: [perpId, 0n] },
        ],
        allowFailure: false,
      });
      const info = packed[0] as { priceDecimals: bigint; lotDecimals: bigint };
      const distanceE6 = contractDistanceE6(
        {
          positionType: position.position.positionType,
          pricePNS: position.position.pricePNS,
          lotLNS: position.position.lotLNS,
          depositCNS: position.position.depositCNS,
          premiumPnlCNS: position.position.premiumPnlCNS,
        },
        {
          priceDecimals: Number(info.priceDecimals),
          lotDecimals: Number(info.lotDecimals),
          maintHdths: maintHdths(packed[1]),
        },
        position.markPricePNS,
      );
      return Response.json({ distanceE6: distanceE6.toString() });
    }
    if (body.op === "balance") {
      const { account, public: client } = clients();
      const ausd = ADDRESSES[TESTNET_ID].ausd;
      if (!ausd) return Response.json({ error: "ausd" }, { status: 500 });
      const balance = await client.readContract({ address: ausd, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
      return Response.json({ balance: balance.toString() });
    }
    return Response.json({ error: "op" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    return Response.json({ error: message }, { status: 500 });
  }
}
