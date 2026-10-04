"use client";

import { PrivyProvider, useGuestAccounts, usePrivy, useWallets } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { monadTestnet } from "viem/chains";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export default function GatePrivyPage() {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: monadTestnet,
        supportedChains: [monadTestnet],
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
          showWalletUIs: false,
        },
      }}
    >
      <Gate />
    </PrivyProvider>
  );
}

function Gate() {
  const { createGuestAccount } = useGuestAccounts();
  const { ready, getAccessToken, sendTransaction, signTypedData, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets.find((item) => item.walletClientType === "privy") ?? wallets[0];
  const [status, setStatus] = useState("idle");
  useEffect(() => {
    if (ready) setStatus((current) => (current === "idle" ? "ready" : current));
  }, [ready]);
  const [signature, setSignature] = useState("");
  const [token, setToken] = useState("");
  const [txHash, setTxHash] = useState("");

  async function createGuest() {
    setStatus("creating");
    try {
      await createGuestAccount();
      setStatus("guest");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "create failed");
    }
  }

  async function accept() {
    const proxy = new URLSearchParams(window.location.search).get("proxy");
    if (!proxy || !wallet) {
      setStatus("missing proxy or wallet");
      return;
    }
    setStatus("accepting");
    const provider = await wallet.getEthereumProvider();
    const nonce = (await provider.request({
      method: "eth_getTransactionCount",
      params: [wallet.address, "pending"],
    })) as string;
    const sent = await sendTransaction(
      {
        to: proxy,
        data: "0x79ba5097",
        gasLimit: 108076,
        nonce: Number(nonce),
        chainId: 10143,
      },
      { address: wallet.address },
    );
    setTxHash(sent.hash);
    setStatus("accepted");
  }

  async function signMandate() {
    const proxy = new URLSearchParams(window.location.search).get("proxy");
    if (!proxy || !wallet) {
      setStatus("missing proxy or wallet");
      return;
    }
    setStatus("signing");
    const signed = await signTypedData(
      {
        domain: { name: "Lifeline", version: "1", chainId: 10143 },
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
          ],
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
        primaryType: "Mandate",
        message: {
          account: proxy,
          perpIds: ["16"],
          triggerBps: 400,
          targetBps: 600,
          maxPerActionCNS: "150000000",
          budgetCNS: "50000000",
          expiry: "1800000000",
          nonce: "0",
        },
      },
      { address: wallet.address },
    );
    const access = (await getAccessToken()) ?? "";
    setSignature(signed.signature);
    setToken(access);
    setStatus("signed");
  }

  return (
    <main>
      <h1>Gate Privy</h1>
      <p id="status">{status}</p>
      <p id="auth">{authenticated ? "yes" : "no"}</p>
      <p id="wallet">{wallet?.address ?? ""}</p>
      <p id="tx">{txHash}</p>
      <p id="signature">{signature}</p>
      <p id="token">{token}</p>
      <button id="create-guest" type="button" onClick={() => void createGuest()}>
        Create guest
      </button>
      <button id="accept" type="button" onClick={() => void accept()}>
        Accept ownership
      </button>
      <button id="sign" type="button" onClick={() => void signMandate()}>
        Sign mandate
      </button>
    </main>
  );
}
