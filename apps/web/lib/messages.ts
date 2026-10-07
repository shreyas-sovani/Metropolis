export type MessageTone = "error" | "success" | "info";

export interface MessageContext {
  distancePct?: string;
  actBelowPct?: string;
  txHref?: string;
}

export interface UserMessage {
  title: string;
  sentence: string;
  action?: string;
  tone: MessageTone;
  txHref?: string;
}

const PROTECTION_ON = "Protection is on";

function aboveTrigger(ctx: MessageContext): string {
  if (ctx.distancePct && ctx.actBelowPct) {
    return `Your position is ${ctx.distancePct} from liquidation, above your act-below line of ${ctx.actBelowPct}. Lifeline will step in if it falls below.`;
  }
  return "Your position is above your act-below line. Lifeline will step in if it falls below.";
}

/** Titles in this map are the verbatim strings from backlog §7B.4.7. */
const TABLE: Record<string, (ctx: MessageContext) => UserMessage> = {
  claimed: () => ({
    title: "You already have a practice account",
    sentence: "Opening it now.",
    tone: "info",
  }),
  rate: () => ({
    title: "Too many new accounts from this network",
    sentence: "Try again in a few minutes, or use demo mode now.",
    action: "Use demo mode",
    tone: "error",
  }),
  empty: () => ({
    title: "All practice accounts are in use",
    sentence: "Demo mode runs the same protection on a shared account.",
    action: "Use demo mode",
    tone: "error",
  }),
  sandbox: () => TABLE.empty!({}),
  sponsor_floor: () => ({
    title: "Practice accounts are paused for a moment",
    sentence: "We're refilling testnet gas. Try demo mode, or retry in a few minutes.",
    action: "Use demo mode",
    tone: "error",
  }),
  turnstile: () => ({
    title: "Please confirm you're human",
    sentence: "Complete the check below. Lifeline continues as soon as it clears.",
    tone: "info",
  }),
  unauthorized: () => ({
    title: "Your wallet didn't start",
    sentence: "Reload the page. If it keeps failing, demo mode works without a wallet.",
    action: "Use demo mode",
    tone: "error",
  }),
  ownership: () => ({
    title: "Ownership wasn't transferred",
    sentence: "Your account is still reserved for you and Lifeline is still protecting it. Try again.",
    action: "Try again",
    tone: "error",
  }),
  ABOVE_TRIGGER: (ctx) => ({
    title: PROTECTION_ON,
    sentence: aboveTrigger(ctx),
    tone: "success",
  }),
  BELOW_MIN: () => ({
    title: PROTECTION_ON,
    sentence: "The top-up needed right now is under 5 AUSD, so Lifeline is waiting.",
    tone: "success",
  }),
  BUDGET_EXHAUSTED: () => ({
    title: "Budget used up",
    sentence: "Raise the budget or withdraw less to let Lifeline keep acting.",
    tone: "error",
  }),
  cap: (ctx) => TABLE.BUDGET_EXHAUSTED!(ctx),
  nonce: () => ({
    title: "That signature was already used",
    sentence: "Sign again.",
    action: "Sign again",
    tone: "error",
  }),
  reverted: (ctx) => ({
    title: "The top-up didn't go through",
    sentence: "No funds moved. Lifeline will retry on its next check.",
    tone: "error",
    txHref: ctx.txHref,
  }),
  rpc: () => ({
    title: "Monad testnet is slow to answer",
    sentence: "Your funds are safe. Retrying…",
    tone: "info",
  }),
  withdraw: () => ({
    title: "Withdrawal didn't go through",
    sentence: "You can withdraw up to your idle AUSD. Try a smaller amount.",
    action: "Try again",
    tone: "error",
  }),
  PAUSED: () => ({
    title: "Lifeline is paused",
    sentence: "New top-ups are stopped while we check something. Your account and funds are unaffected.",
    tone: "info",
  }),
  MARK_INVALID: () => ({
    title: "The price isn't ready",
    sentence: "Lifeline will check this position again in a moment.",
    tone: "info",
  }),
  NO_POSITION: () => ({
    title: "There's no open position",
    sentence: "Lifeline protects an open position. This account doesn't have one on that market.",
    tone: "error",
  }),
  COOLDOWN: () => ({
    title: "Lifeline just added margin",
    sentence: "It waits a few blocks before the next top-up.",
    tone: "info",
  }),
  NO_FREE_BALANCE: () => ({
    title: "No idle AUSD to add",
    sentence: "Add AUSD to this account and Lifeline can move it into margin.",
    tone: "error",
  }),
  EXPIRED: () => ({
    title: "This protection expired",
    sentence: "Choose a new end time to keep it on.",
    action: "Resume protection",
    tone: "error",
  }),
};

const ALIASES: Record<string, string> = {
  "sponsor floor": "sponsor_floor",
  sponsor: "sponsor_floor",
  wallet: "unauthorized",
  pending_owner: "ownership",
  PENDING_OWNER: "ownership",
};

export function userMessage(code: string, ctx: MessageContext = {}): UserMessage {
  const key = ALIASES[code] ?? code;
  const build = TABLE[key];
  if (!build) {
    return {
      title: "That didn't go through",
      sentence: "Try again in a moment.",
      action: "Try again",
      tone: "error",
    };
  }
  return build(ctx);
}

export const MESSAGE_CODES = Object.keys(TABLE);
