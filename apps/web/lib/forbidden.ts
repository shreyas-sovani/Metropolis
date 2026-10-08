/** Visible-text bans from backlog §7B.4.6. Field names inside `code` and `pre` are allowed. */
export const FORBIDDEN: readonly RegExp[] = [
  /\bCNS\b/,
  /\bPNS\b/,
  /\bLNS\b/,
  /\bbps\b/i,
  /\w+E6\b/,
  /\bnonce\b/i,
  /\bselector\b/i,
  /\bcalldata\b/i,
  /\bproxy\b/i,
  /DelegatedAccount/,
  /acceptOwnership/,
  /increasePositionCollateral/,
  /execOrder/,
  /pendingOwner/,
  /\boperator\b/i,
  /\bsandbox\b/i,
  /\bkeeper\b/i,
  /Durable Object/,
  /perp\s*\d/i,
  /\b(?:ABOVE_TRIGGER|BELOW_MIN|MARK_INVALID|PAUSED|EXPIRED)\b/,
  /\b[A-Z]{3,}_[A-Z_]+\b/,
  /ms from/i,
  /Wallet transactions before/,
  /\bundefined\b/,
  /\bNaN\b/,
  /\bnull\b/,
];

export function forbiddenHit(text: string): string | null {
  for (const pattern of FORBIDDEN) {
    pattern.lastIndex = 0;
    const match = text.match(pattern);
    if (match?.[0]) return match[0];
  }
  return null;
}
