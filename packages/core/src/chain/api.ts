import type { Address, PublicClient } from "viem";
import { ADDRESSES } from "../config/addresses.js";
import { rpcUrls, type ChainId } from "../config/chains.js";
import {
  readAccountByAddr,
  readAccounts,
  readPositionsForAccount,
  type AccountInfo,
  type AccountPosition,
} from "./accounts.js";
import { createReadClient } from "./client.js";
import { listPerps, readExchangeSnapshot, readMarket, type MarketSnapshot, type PerpInfo } from "./readers.js";

export interface ChainApi {
  client: PublicClient;
  listPerps: () => Promise<PerpInfo[]>;
  readMarket: (perpId: number) => Promise<MarketSnapshot>;
  readAllPositions: () => Promise<MarketSnapshot[]>;
  readAccounts: (ids: readonly bigint[]) => Promise<AccountInfo[]>;
  readAccountByAddr: (addr: Address) => Promise<AccountInfo>;
  readPositionsForAccount: (accountId: bigint) => Promise<AccountPosition[]>;
}

export interface ChainReadOptions {
  urls?: readonly string[];
  timeout?: number;
}

/** Library API over the G8 readers. Markets come from the onchain bitmap. */
export function openChain(chainId: ChainId, options: ChainReadOptions = {}): ChainApi {
  const urls = options.urls ?? rpcUrls(chainId);
  const client = createReadClient(chainId, urls, options.timeout);
  const exchange = ADDRESSES[chainId].exchange;
  return {
    client,
    listPerps: () => listPerps(client, exchange),
    readMarket: (perpId: number) => readMarket(client, exchange, perpId),
    readAllPositions: () => readExchangeSnapshot(client, exchange),
    readAccounts: (ids: readonly bigint[]) => readAccounts(client, exchange, ids),
    readAccountByAddr: (addr: Address) => readAccountByAddr(client, exchange, addr),
    readPositionsForAccount: (accountId: bigint) => readPositionsForAccount(client, exchange, accountId),
  };
}
