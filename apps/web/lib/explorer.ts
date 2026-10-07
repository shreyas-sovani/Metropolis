import { MAINNET_ID, TESTNET_ID } from "@lifeline/core";

const TESTNET_EXPLORER = "https://testnet.monadexplorer.com";
/** The replay hash renders on Monadscan. Monadvision returned 403 to the same request. */
export const MAINNET_EXPLORER = "https://monadscan.com";

export function explorerOrigin(chainId: number): string {
  return chainId === MAINNET_ID ? MAINNET_EXPLORER : TESTNET_EXPLORER;
}

export function txUrl(chainId: number, hash: string): string {
  return `${explorerOrigin(chainId)}/tx/${hash}`;
}

export function addressUrl(chainId: number, address: string): string {
  return `${explorerOrigin(chainId)}/address/${address}`;
}

export function blockUrl(chainId: number, block: number): string {
  return `${explorerOrigin(chainId)}/block/${block}`;
}

export { MAINNET_ID, TESTNET_ID };
