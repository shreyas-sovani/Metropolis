"use client";

import { useGuestAccounts, usePrivy, useWallets, type ConnectedWallet } from "@privy-io/react-auth";
import { Component, type ReactNode, useRef } from "react";
import { getAddress } from "viem";
import { disarmText, type ArmBody, type ClaimBody } from "../../../lib/try-flow";
import { e2eClient, type TryClient, type TrySession } from "./e2e-client";
import { TryPanel } from "./try-panel";

const offlineClient: TryClient = {
  async prepare() {
    return { ok: false, sandbox: true };
  },
  async claim(_session, _turnstileToken) {
    return { status: 503, body: { sandbox: true, error: "empty" } };
  },
  async send() {
    throw new Error("wallet");
  },
  async arm() {
    return { status: 401, body: { error: "wallet" } };
  },
  async disarm() {
    return { status: 401, body: { error: "wallet" } };
  },
  async keep() {},
};

export function TryLifeline() {
  if (process.env.NEXT_PUBLIC_E2E_WALLET === "test") return <TryPanel client={e2eClient} />;
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) return <TryPanel client={offlineClient} />;
  return (
    <SandboxBoundary>
      <PrivyTry />
    </SandboxBoundary>
  );
}

class SandboxBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) return <TryPanel client={offlineClient} />;
    return this.props.children;
  }
}

function subject(token: string): string {
  const part = token.split(".")[1];
  if (!part) throw new Error("token");
  const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: string };
  if (!json.sub) throw new Error("sub");
  return json.sub;
}

function PrivyTry() {
  const { createGuestAccount } = useGuestAccounts();
  const { authenticated, getAccessToken, login, sendTransaction, signMessage, signTypedData } = usePrivy();
  const { wallets } = useWallets();
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;
  const authRef = useRef(authenticated);
  authRef.current = authenticated;

  const client: TryClient = {
    async prepare() {
      try {
        if (!authRef.current) {
          await Promise.race([
            createGuestAccount(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("privy")), 8_000)),
          ]);
        }
        const wallet = await waitForWallet(walletsRef);
        const token = await getAccessToken();
        if (!wallet || !token) return { ok: false, sandbox: true };
        return { ok: true, session: { userId: subject(token), address: wallet.address } };
      } catch {
        return { ok: false, sandbox: true };
      }
    },
    async claim(session, turnstileToken) {
      const response = await withProof(session, walletsRef, getAccessToken, signMessage, "/api/lifeline/claim", {
        turnstileToken,
      });
      return { status: response.status, body: response.body as ClaimBody };
    },
    async send(session, to, data, gas) {
      const wallet = matchWallet(walletsRef.current, session.address);
      if (!wallet) throw new Error("wallet");
      const provider = await wallet.getEthereumProvider();
      const nonceHex = (await provider.request({
        method: "eth_getTransactionCount",
        params: [wallet.address, "pending"],
      })) as string;
      const nonce = Number(nonceHex);
      const sent = await sendTransaction(
        { to, data: data as `0x${string}`, gasLimit: Number(gas), nonce, chainId: 10143 },
        { address: wallet.address },
      );
      return { hash: sent.hash, nonce };
    },
    async arm(session, mandate) {
      const wallet = matchWallet(walletsRef.current, session.address);
      if (!wallet) return { status: 401, body: { error: "wallet" } };
      const signed = await signTypedData(mandateTyped(mandate), { address: wallet.address });
      const response = await withProof(session, walletsRef, getAccessToken, signMessage, "/api/lifeline/arm", {
        mandate,
        signature: signed.signature,
      });
      return { status: response.status, body: response.body as ArmBody };
    },
    async disarm(session, proxy, nonce) {
      const wallet = matchWallet(walletsRef.current, session.address);
      if (!wallet) return { status: 401, body: { error: "wallet" } };
      const signed = await signMessage({ message: disarmText(getAddress(proxy), nonce) }, { address: wallet.address });
      const response = await withProof(session, walletsRef, getAccessToken, signMessage, "/api/lifeline/disarm", {
        proxy,
        nonce,
        signature: signed.signature,
      });
      return { status: response.status, body: response.body as { active?: boolean; error?: string } };
    },
    async keep() {
      await login();
    },
  };

  return <TryPanel client={client} />;
}

function matchWallet(wallets: ConnectedWallet[], address: string): ConnectedWallet | undefined {
  return wallets.find((item) => item.address.toLowerCase() === address.toLowerCase()) ?? wallets[0];
}

async function waitForWallet(walletsRef: { current: ConnectedWallet[] }) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const wallet = walletsRef.current[0];
    if (wallet) return wallet;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function mandateTyped(mandate: Record<string, string | number | string[]>) {
  return {
    domain: { name: "Lifeline", version: "1", chainId: 10143 },
    types: {
      Mandate: [
        { name: "account", type: "address" },
        { name: "perpIds", type: "uint256[]" },
        { name: "triggerBps", type: "uint16" },
        { name: "targetBps", type: "uint16" },
        { name: "maxPerActionCNS", type: "uint256" },
        { name: "budgetCNS", type: "uint256" },
        { name: "expiry", type: "uint64" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "Mandate" as const,
    message: {
      account: String(mandate.account),
      perpIds: mandate.perpIds as string[],
      triggerBps: Number(mandate.triggerBps),
      targetBps: Number(mandate.targetBps),
      maxPerActionCNS: String(mandate.maxPerActionCNS),
      budgetCNS: String(mandate.budgetCNS),
      expiry: String(mandate.expiry),
      nonce: String(mandate.nonce),
    },
  };
}

async function withProof(
  session: TrySession,
  walletsRef: { current: ConnectedWallet[] },
  getAccessToken: () => Promise<string | null>,
  signMessage: (message: { message: string }, options: { address: string }) => Promise<{ signature: string }>,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const token = await getAccessToken();
  const wallet = matchWallet(walletsRef.current, session.address);
  if (!token || !wallet) return { status: 401, body: { error: "unauthorized" } };
  const nonce = crypto.randomUUID();
  const signed = await signMessage(
    { message: `lifeline:${session.userId}:${wallet.address}:${nonce}` },
    { address: wallet.address },
  );
  const response = await fetch(path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-lifeline-address": wallet.address,
      "x-lifeline-signature": signed.signature,
      "x-lifeline-nonce": nonce,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
