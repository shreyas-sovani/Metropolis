import { formatAusd } from "./account";
import { distancePctLabel } from "./protection";

export interface ActivityAction {
  txHash: string;
  amountCNS: string;
  distBefore?: string | null;
  distAfter?: string | null;
  createdAt?: number | null;
}

export interface ActivityClaim {
  claimedAt?: number;
  acceptedAt?: number | null;
  transferTx?: string | null;
  acceptTx?: string | null;
}

export interface ActivityNote {
  kind: "signed" | "adjusted" | "paused" | "resumed";
  at: number;
  targetBps?: number;
}

export interface ActivityRow {
  title: string;
  sentence: string;
  at: number;
  hash?: string;
}

function ausd(amount: string): string {
  return `${formatAusd(amount)} AUSD`;
}

function noteCopy(note: ActivityNote): { title: string; sentence: string } {
  if (note.kind === "paused") return { title: "You paused protection", sentence: "Lifeline won't add margin until you resume." };
  if (note.kind === "resumed") return { title: "You resumed protection", sentence: "Lifeline will add margin again when the position falls inside the line." };
  if (note.kind === "adjusted") {
    const line = note.targetBps == null ? "" : ` The safety line is ${(note.targetBps / 100).toFixed(1)}%.`;
    return { title: "You adjusted the safety line", sentence: `A new signature replaced the previous one.${line}` };
  }
  return { title: "You turned on protection", sentence: "Signed. This did not send a transaction." };
}

/** Newest first. Claim, ownership, local notes, and top-ups. */
export function activityRows(input: {
  claim: ActivityClaim | null;
  actions: readonly ActivityAction[];
  notes: readonly ActivityNote[];
}): ActivityRow[] {
  const rows: ActivityRow[] = [];
  const claim = input.claim;
  if (claim?.claimedAt) {
    rows.push({
      title: "Practice account reserved for you",
      sentence: "This testnet account is held for your wallet.",
      at: claim.claimedAt,
      hash: claim.transferTx || undefined,
    });
  }
  if (claim?.acceptedAt) {
    rows.push({
      title: "You took ownership",
      sentence: "Only you can withdraw from this account.",
      at: claim.acceptedAt,
      hash: claim.acceptTx || undefined,
    });
  }
  for (const note of input.notes) {
    const copy = noteCopy(note);
    rows.push({ ...copy, at: note.at });
  }
  for (const action of input.actions) {
    if (!action.txHash) continue;
    const before = action.distBefore ? distancePctLabel(action.distBefore) : "";
    const after = action.distAfter ? distancePctLabel(action.distAfter) : "";
    const moved = before && after ? `${before} → ${after}` : "Margin updated";
    rows.push({
      title: `Lifeline added ${ausd(action.amountCNS)}`,
      sentence: moved,
      at: action.createdAt && action.createdAt > 0 ? action.createdAt : claim?.acceptedAt ?? claim?.claimedAt ?? 0,
      hash: action.txHash,
    });
  }
  return rows.sort((left, right) => right.at - left.at);
}

export function daysLeft(expirySec: string, nowSec: number): string {
  const left = Number(expirySec) - nowSec;
  const days = Math.max(0, Math.ceil(left / 86_400));
  return days === 1 ? "1 day left" : `${days} days left`;
}

export function heartbeatLine(lastAlarmAt: number | null, lastBlock: number | null, nowMs: number): string {
  if (lastAlarmAt == null) return "Lifeline has not reported a check yet.";
  const sec = Math.max(0, Math.floor((nowMs - lastAlarmAt) / 1000));
  const ago = sec < 60 ? `${sec} s ago` : `${Math.floor(sec / 60)} min ago`;
  const block = lastBlock == null ? "" : ` · block ${lastBlock.toLocaleString("en-US")}`;
  return `Checked ${ago}${block}`;
}
