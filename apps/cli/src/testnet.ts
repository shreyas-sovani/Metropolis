import {
  ADDRESSES,
  CHAINS,
  TESTNET_ID,
  rpcUrls,
} from "@lifeline/core";
import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { alchemyTestnetUrl } from "./roles.js";

const chain = CHAINS[TESTNET_ID];

export function testnetPublicClient(): PublicClient {
  const urls = rpcUrls(TESTNET_ID, alchemyTestnetUrl());
  return createPublicClient({
    chain,
    transport: fallback(urls.map((url) => http(url, { timeout: 20_000, retryCount: 1 }))),
  });
}

export function testnetWallet(account: PrivateKeyAccount): WalletClient {
  const url = rpcUrls(TESTNET_ID, alchemyTestnetUrl())[0];
  if (!url) throw new Error("no testnet RPC");
  return createWalletClient({
    account,
    chain,
    transport: http(url, { timeout: 30_000, retryCount: 1 }),
  });
}

export function testnetContracts() {
  const addresses = ADDRESSES[TESTNET_ID];
  if (!addresses.faucet || !addresses.ausd) throw new Error("testnet faucet or AUSD missing");
  return { faucet: addresses.faucet, ausd: addresses.ausd };
}
