import {
  ADDRESSES,
  CHAIN_IDS,
  CHAINS,
  exchangeAbi,
  faucetAbi,
  rpcUrls,
  type ChainAddresses,
  type ChainId,
} from "@lifeline/core";
import {
  createPublicClient,
  fallback,
  getAddress,
  http,
  type Address,
  type PublicClient,
} from "viem";

const NAMES = ["exchange", "factory", "ausd", "faucet", "multicall3"] as const;

function clientFor(chainId: ChainId): PublicClient {
  const alchemy =
    chainId === 143
      ? process.env.ALCHEMY_MONAD_MAINNET_URL
      : process.env.ALCHEMY_MONAD_TESTNET_URL;
  return createPublicClient({
    chain: CHAINS[chainId],
    transport: fallback(
      rpcUrls(chainId, alchemy).map((url) =>
        http(url, { timeout: 20_000, retryCount: 1 }),
      ),
    ),
  });
}

function collateralToken(info: unknown): Address {
  if (Array.isArray(info)) return getAddress(info[4] as Address);
  if (info && typeof info === "object" && "collateralToken" in info) {
    return getAddress((info as { collateralToken: Address }).collateralToken);
  }
  throw new Error("unexpected getExchangeInfo result");
}

function present(addresses: ChainAddresses): Array<[string, Address]> {
  const rows: Array<[string, Address]> = [];
  for (const name of NAMES) {
    const value = addresses[name];
    if (value) rows.push([name, value]);
  }
  return rows;
}

export async function verifyAddresses(): Promise<number> {
  const failures: string[] = [];

  for (const chainId of CHAIN_IDS) {
    const client = clientFor(chainId);
    const label = chainId === 143 ? "mainnet" : "testnet";
    const addresses = ADDRESSES[chainId];

    for (const [name, address] of present(addresses)) {
      const code = await client.getBytecode({ address });
      const bytes = code && code !== "0x" ? (code.length - 2) / 2 : 0;
      console.log(`${label} ${chainId} ${name} ${address} code=${bytes}`);
      if (bytes === 0) failures.push(`${label} ${name} has no code`);
    }

    const info = await client.readContract({
      address: addresses.exchange,
      abi: exchangeAbi,
      functionName: "getExchangeInfo",
    });
    const collateral = collateralToken(info);
    const ausd = getAddress(addresses.ausd);
    const collateralOk = collateral === ausd;
    console.log(
      `${label} exchange collateral ${collateral} ${collateralOk ? "matches" : "DIFFERS FROM"} AUSD ${ausd}`,
    );
    if (!collateralOk) failures.push(`${label} collateral token mismatch`);

    if (addresses.faucet) {
      const token = getAddress(
        (await client.readContract({
          address: addresses.faucet,
          abi: faucetAbi,
          functionName: "token",
        })) as Address,
      );
      const tokenOk = token === ausd;
      console.log(
        `${label} faucet token ${token} ${tokenOk ? "matches" : "DIFFERS FROM"} AUSD ${ausd}`,
      );
      if (!tokenOk) failures.push(`${label} faucet token mismatch`);
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    return 1;
  }
  console.log("verify:addresses ok");
  return 0;
}
