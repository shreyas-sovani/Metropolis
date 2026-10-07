import { TRADEOFF } from "./copy";

export const H1 = "Don't get liquidated with money in your account.";

export const SUB =
  "Lifeline moves your own idle AUSD into a Perpl position's margin when it nears liquidation. Its key can add margin and nothing else.";

export const PRIMARY = "Protect a position.";

export const HERO_PLACEHOLDER = "Paste a Perpl account address.";

export const TOUR_LINK = "Judging Metropolis? Take the 3-minute tour.";

export const LIVE_LABEL = "Live on Monad mainnet · read-only.";

export const LIVE_WAIT = "Live numbers are taking a moment.";

export const ADDRESS_ERROR = "That isn't a valid address.";

export const PROBLEM_QUOTE = "A position can be liquidated even while your account holds ample free balance.";

export const PROBLEM_SOURCE = "Perpl documentation.";

export const PROBLEM_CAPTION = "Perpl liquidates the position. The idle AUSD never moves.";

export const HOW = [
  {
    title: "Give Lifeline a narrow key.",
    body: "Your Perpl account appoints Lifeline's key. It can do one thing: move your account's idle AUSD into a position's margin.",
  },
  {
    title: "Draw your safety line.",
    body: "Choose how far from liquidation you want to stay, a per top-up limit, and a total budget. You sign it; it costs no gas.",
  },
  {
    title: "Lifeline steps in.",
    body: "Lifeline checks every 2 seconds. When a position falls below your line, it adds margin from your idle AUSD in the next block.",
  },
] as const;

export const SECURITY_HEADING = "What Lifeline's key can't do.";

export const CAN = "Add your idle AUSD to a position's margin, within your budget and per top-up limit.";

export const CANT = "Open, close, or change trades. Withdraw or move funds out. Remove margin. Act after you pause it.";

/** G1 proxy: the six extra permissions were revoked, and a top-up still moved margin. */
export const CHECKED_ACCOUNT = "0xEc73AFB31b20729160c247A3009C193a4842e95A";

export const CHECKED_TOPUP = "0xf322eed96f2f1460cc6477b3037ce2a7cfd56d3a31198242712d236644099d85";

export const PROOF = [
  {
    title: "Twins",
    body: "Same trade, opened twice. One has Lifeline.",
    href: "/twins",
    link: "See the twins",
  },
  {
    title: "A real liquidation",
    body: "A real Bitcoin long liquidated on mainnet, and what Lifeline would have added.",
    href: "/replay",
    link: "See the liquidation",
  },
  {
    title: "Contract-exact",
    body: "Our liquidation price matches Perpl's contract to the tick on 912 live positions.",
    href: "/methodology",
    link: "See the method",
  },
] as const;

export const SAVES_BODY =
  "Positions still open after the market crossed the liquidation price they had before Lifeline's top-up.";

export const FAQ: readonly { q: string; a: string; href?: string; link?: string }[] = [
  {
    q: "Is this real or a simulation?",
    a: "Protection runs as real transactions on Monad testnet. The market data is read live from Monad mainnet. Testnet tokens have no value.",
  },
  {
    q: "Why testnet?",
    a: "Mainnet stays read-only during the hackathon. Mainnet protection is coming via API-key mode.",
  },
  {
    q: "What can Lifeline's key do with my account?",
    a: "It can add your idle AUSD to a position's margin, within your budget and per top-up limit. It cannot open, close, or change trades, withdraw or move funds out, remove margin, or act after you pause it.",
  },
  {
    q: "What if the price keeps moving against me?",
    a: TRADEOFF,
  },
  {
    q: "How do I stop it?",
    a: "Pause protection on your dashboard. Lifeline stops adding margin until you resume protection. You can also withdraw idle AUSD, which only you can do.",
  },
  {
    q: "Does it cost anything?",
    a: "It is free on testnet. Signing your safety line needs no gas. A little testnet MON is sent to your wallet for the one ownership transaction.",
  },
  {
    q: "Is the liquidation price exact?",
    a: "Yes. Lifeline computes the liquidation price the same way Perpl's contract does, and rounds one tick toward safety.",
    href: "/methodology",
    link: "See how the price is checked.",
  },
];

export function sentenceCount(text: string): number {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}
