export const ONE_LINER = "Lifeline keeps Perpl positions from being liquidated while money sits idle next to them.";

export const TRADEOFF =
  "Lifeline moves your idle AUSD into this position's margin; if the price keeps moving against you, that AUSD is at risk too.";

export const WITHDRAW_NOTE =
  "Lifeline's key can't do this. Withdraw is owner-only in Perpl's contract. The operator's other permissions are revoked onchain.";

export const PENDING_OWNER =
  "You are still the pending owner. The house mandate keeps protecting this position. Retry acceptance.";

export const REVOKED_SELECTORS = [
  "execOrder",
  "execOrders",
  "requestDecreasePositionCollateral",
  "buyLiquidations",
  "depositCollateral",
  "allowOrderForwarding",
] as const;

export const WITHDRAW_AUSD = 50n * 1_000_000n;
