export interface ActionRow {
  txHash: string;
  block: number | null;
  amountCNS: string;
  perpId: string;
  status: string;
}

export function sameActionHashes(api: readonly { txHash: string }[], stored: readonly { txHash: string }[]): boolean {
  const left = api.map((row) => row.txHash.toLowerCase()).sort();
  const right = stored.map((row) => row.txHash.toLowerCase()).filter((hash) => hash.startsWith("0x")).sort();
  if (left.length !== right.length) return false;
  return left.every((hash, index) => hash === right[index]);
}
