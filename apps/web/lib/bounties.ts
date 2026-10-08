export const SITE = "https://lifeline-five-murex.vercel.app";

/** A mainnet account the check page offers as a live example. */
export const MAINNET_EXAMPLE = "0x77A89C51f106D6cD547542a3A83FE73cB4459135";

/** A pool account from `cli-state/pool.json` (BTC long, perp 16). */
export const PRACTICE_ACCOUNT = "0xe3929EB4561f70A2Eb1Bc78957CCd0A87dABB362";

export const PRACTICE_LOOKUP = `/a/${PRACTICE_ACCOUNT}?chain=10143`;

export const TOPUP = "https://testnet.monadexplorer.com/tx/0xf322eed96f2f1460cc6477b3037ce2a7cfd56d3a31198242712d236644099d85";
export const ACCEPT = "https://testnet.monadexplorer.com/tx/0xaa32f3a1aeace9c5582de8f31ec49499af4673fd6d89762de88cc50b10f73dac";

export interface BountyLink {
  href: string;
  label: string;
}

export interface BountyProof {
  name: string;
  requirement: string;
  how: string;
  code: string;
  proof: string;
  proofLabel: string;
  also?: BountyLink;
}

/** Live proofs for the prize map. Relative proofs are on the production site. */
export const BOUNTIES: readonly BountyProof[] = [
  {
    name: "Perpl API",
    requirement: "A public risk number an integrator can call.",
    how: "The risk route returns the contract-exact liquidation price, distance, idle balance, dry run, and forfeit.",
    code: "apps/web/app/api/v1/risk/[address]/route.ts",
    proof: "/developers",
    proofLabel: "Risk API",
  },
  {
    name: "Perpl Analytics",
    requirement: "Show where the book can break, with the contract's own liquidation price.",
    how: "The market map is built from onchain positions. The Contract-exact badge is on when calibration matches the fork.",
    code: "apps/web/app/(site)/radar/radar-board.tsx",
    proof: "/radar",
    proofLabel: "Open the market map",
  },
  {
    name: "Envio",
    requirement: "History of real liquidations, not a hardcoded list.",
    how: "The server tails HyperSync and serves the last good payload when the indexer is rate-limited.",
    code: "apps/web/lib/history-store.ts",
    proof: "/api/liquidations",
    proofLabel: "Liquidation history",
    also: { href: "/radar", label: "The tape on the market map" },
  },
  {
    name: "Privy",
    requirement: "A wallet in the browser that can take ownership and sign a safety line.",
    how: "Protect a position creates a wallet in this browser, takes ownership in one transaction, and signs the safety line.",
    code: "apps/web/app/(site)/app/protect-app.tsx",
    proof: "/app",
    proofLabel: "Protect a position",
    also: { href: ACCEPT, label: "Ownership transaction" },
  },
  {
    name: "Track 1",
    requirement: "A position was kept off liquidation by its own idle collateral.",
    how: "Lifeline added idle AUSD to a claimed testnet position. The owner could still withdraw.",
    code: "apps/worker/src/tick.ts",
    proof: "/twins",
    proofLabel: "Twin pairs",
    also: { href: TOPUP, label: "Top-up transaction" },
  },
];

export const JUDGE_PATH: readonly { label: string; href: string }[] = [
  { label: "Live market risk", href: "/radar" },
  { label: "A real liquidation", href: "/replay" },
  { label: "Protect a position", href: "/app" },
  { label: "Try to break it", href: "/twins" },
  { label: "Evidence", href: "/tour/evidence" },
];

export function proofUrl(proof: string): string {
  return proof.startsWith("http") ? proof : `${SITE}${proof}`;
}
