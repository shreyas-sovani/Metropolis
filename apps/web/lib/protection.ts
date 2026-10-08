/** Verbatim safety-line copy from backlog §7B.5. */
export function safetyCopy(distancePct: string, safetyPct: string, actBelowPct: string): string {
  return `Your position is ${distancePct} from liquidation. Lifeline recommends a safety line of ${safetyPct} and will step in below ${actBelowPct}.`;
}

export function insideLineCopy(): string {
  return "That's inside your line, so Lifeline will add margin right after you sign.";
}

export function outsideLineCopy(): string {
  return "That's above your line, so Lifeline will wait and act if the price moves against you.";
}

export function oneDecimal(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

export function distancePctLabel(distanceE6: string): string {
  const value = Number(distanceE6) / 10_000;
  return `${value.toFixed(1)}%`;
}

/** Safety line is the target. The act-below line sits 2 percentage points under it. */
export function linesFromSafety(safetyPct: number): { targetBps: number; triggerBps: number } {
  const targetBps = Math.round(safetyPct * 100);
  const triggerBps = Math.max(1, targetBps - 200);
  return { targetBps, triggerBps };
}

export type ProtectPhase = "idle" | "preparing" | "claiming" | "owning" | "choosing" | "signing" | "protected" | "demo" | "error";

const STEP_RANK: Record<ProtectPhase, number> = {
  idle: 0,
  preparing: 0,
  claiming: 0,
  error: 0,
  demo: 0,
  owning: 1,
  choosing: 2,
  signing: 2,
  protected: 3,
};

export function stepStates(phase: ProtectPhase): Array<"upcoming" | "current" | "done"> {
  if (phase === "protected") return ["done", "done", "done", "done"];
  const at = STEP_RANK[phase];
  return [0, 1, 2, 3].map((index) => (index < at ? "done" : index === at ? "current" : "upcoming"));
}
