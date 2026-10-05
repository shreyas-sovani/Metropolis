import { MAINNET_ID, TESTNET_ID, liquidationPricePNS, type ChainId } from "@lifeline/core";

/** Contract-truth liquidation price. Delegates to the core rule so the fork summary cannot drift. */
export function contractLiqPNS(input: {
  positionType: number;
  pricePNS: bigint;
  lotLNS: bigint;
  depositCNS: bigint;
  premiumPnlCNS: bigint;
  priceDecimals: number;
  lotDecimals: number;
  maintHdths: bigint;
}): bigint {
  return liquidationPricePNS(
    {
      positionType: input.positionType,
      pricePNS: input.pricePNS,
      lotLNS: input.lotLNS,
      depositCNS: input.depositCNS,
      premiumPnlCNS: input.premiumPnlCNS,
    },
    {
      priceDecimals: input.priceDecimals,
      lotDecimals: input.lotDecimals,
      maintHdths: input.maintHdths,
    },
  );
}

/** Reject anything except a local HTTP fork. Writes never go to a public RPC. */
export function assertForkUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("fork url is invalid");
  }
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "http:" || !local) {
    throw new Error("fork client must be http://127.0.0.1 or http://localhost");
  }
}

export interface ChainCounts {
  chainId: ChainId;
  positions: number;
  markets: number;
  shorts: number;
  withPremium: number;
  withResidue: number;
  exact: number;
}

/** Coverage bar from G4 step b. Empty means the combined fork run passed. */
export function coverageGaps(chains: readonly ChainCounts[]): string[] {
  const gaps: string[] = [];
  if (chains.length < 2) gaps.push("both chains are required");
  const positions = total(chains, "positions");
  const shorts = total(chains, "shorts");
  const premium = total(chains, "withPremium");
  const residue = total(chains, "withResidue");
  if (positions < 600) gaps.push(`positions ${positions} < 600`);
  if (shorts < 100) gaps.push(`shorts ${shorts} < 100`);
  if (premium < 100) gaps.push(`premium ${premium} < 100`);
  if (residue < 50) gaps.push(`residue ${residue} < 50`);
  for (const chain of chains) {
    if (chain.markets < 4) gaps.push(`chain ${chain.chainId} markets ${chain.markets} < 4`);
  }
  return gaps;
}

export function matchPct(exact: number, positions: number): number {
  if (positions === 0) return 0;
  return Math.round((exact / positions) * 1_000_000) / 10_000;
}

export function parseForkArgs(argv: readonly string[]): readonly ChainId[] | null {
  if (!argv.includes("--fork")) {
    if (argv.length > 0) throw new Error(`unknown gate:4 arg ${argv[0]}`);
    return null;
  }
  let chain: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fork") continue;
    if (arg === "--chain") {
      chain = argv[index + 1];
      if (chain === undefined) throw new Error("--chain needs 10143, 143, or both");
      index += 1;
      continue;
    }
    throw new Error(`unknown gate:4 arg ${arg}`);
  }
  if (chain === undefined || chain === "both") return [TESTNET_ID, MAINNET_ID];
  if (chain === String(TESTNET_ID)) return [TESTNET_ID];
  if (chain === String(MAINNET_ID)) return [MAINNET_ID];
  throw new Error("--chain needs 10143, 143, or both");
}

function total(chains: readonly ChainCounts[], key: "positions" | "shorts" | "withPremium" | "withResidue"): number {
  let sum = 0;
  for (const chain of chains) sum += chain[key];
  return sum;
}
