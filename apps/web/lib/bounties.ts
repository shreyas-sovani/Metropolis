export const SITE = "https://lifeline-five-murex.vercel.app";

const RISK = "/api/v1/risk/0x77A89C51f106D6cD547542a3A83FE73cB4459135?chain=143";
const LOOKUP = "/a/0x77A89C51f106D6cD547542a3A83FE73cB4459135?chain=143";
const TOPUP = "https://testnet.monadexplorer.com/tx/0xf322eed96f2f1460cc6477b3037ce2a7cfd56d3a31198242712d236644099d85";
const ACCEPT = "https://testnet.monadexplorer.com/tx/0xaa32f3a1aeace9c5582de8f31ec49499af4673fd6d89762de88cc50b10f73dac";

export interface BountyProof {
  name: string;
  requirement: string;
  how: string;
  code: string;
  proof: string;
  proofLabel: string;
}

/** Live proofs for the prize map. Relative proofs are on the production site. */
export const BOUNTIES: readonly BountyProof[] = [
  {
    name: "Perpl API",
    requirement: "A public risk number an integrator can call.",
    how: "The risk route returns the contract-exact liquidation price, distance, idle balance, dry run, and forfeit.",
    code: "apps/web/app/api/v1/risk/[address]/route.ts",
    proof: RISK,
    proofLabel: "Live risk response",
  },
  {
    name: "Perpl Analytics",
    requirement: "Show where the book can break, with the contract's own liquidation price.",
    how: "The radar is built from onchain positions. The Contract-exact badge is on when calibration matches the fork.",
    code: "apps/web/app/(shell)/radar-board.tsx",
    proof: "/",
    proofLabel: "Open the radar",
  },
  {
    name: "Envio",
    requirement: "History of real liquidations, not a hardcoded list.",
    how: "The server tails HyperSync and serves the last good payload when the indexer is rate-limited.",
    code: "apps/web/lib/history-store.ts",
    proof: "/api/liquidations",
    proofLabel: "Liquidation history",
  },
  {
    name: "Privy",
    requirement: "A guest wallet that can accept a position and sign a mandate.",
    how: "Try Lifeline creates a Privy guest, accepts ownership in one transaction, and signs the EIP-712 mandate.",
    code: "apps/web/app/(shell)/lifeline/try-lifeline.tsx",
    proof: ACCEPT,
    proofLabel: "Guest acceptOwnership",
  },
  {
    name: "Track 1",
    requirement: "A position was kept off liquidation by its own idle collateral.",
    how: "The keeper topped up a claimed testnet position, then the owner withdrew and disarmed.",
    code: "apps/worker/src/tick.ts",
    proof: TOPUP,
    proofLabel: "Top-up transaction",
  },
];

export const JUDGE_PATH: readonly { label: string; href: string }[] = [
  { label: "Pre-filled mainnet lookup", href: LOOKUP },
  { label: "Claim a testnet position", href: "/lifeline" },
  { label: "Twin pairs", href: "/twins" },
  { label: "Methodology", href: "/methodology" },
];

export function proofUrl(proof: string): string {
  return proof.startsWith("http") ? proof : `${SITE}${proof}`;
}
