import { radarId, type ChainId } from "@lifeline/core";
import { getAddress, isAddress, type Address, type Hex } from "viem";

export async function resolveHighlightId(input: {
  chainId: ChainId;
  highlight: string | null;
  salt: Hex;
  lookup: (address: Address) => Promise<bigint | null>;
}): Promise<string | null> {
  if (!input.highlight || !isAddress(input.highlight)) return null;
  try {
    const accountId = await input.lookup(getAddress(input.highlight));
    if (accountId === null) return null;
    return radarId(input.salt, input.chainId, accountId);
  } catch {
    return null;
  }
}
