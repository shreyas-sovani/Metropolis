import { encodeAbiParameters, keccak256, type Hex } from "viem";

/** `RADAR_SALT` is 32 bytes, stored as 64 hex characters with or without `0x`. */
export function radarSalt(value: string): Hex {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("RADAR_SALT must be 32 bytes");
  return `0x${hex.toLowerCase()}`;
}

/** First 8 hex characters of keccak(RADAR_SALT, chainId, accountId). */
export function radarId(salt: Hex, chainId: number, accountId: bigint): string {
  const hash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "uint256" }],
      [salt, BigInt(chainId), accountId],
    ),
  );
  return hash.slice(2, 10);
}
