export const ONE_LINER = "Lifeline keeps Perpl positions from being liquidated while money sits idle next to them.";

export const TRADEOFF =
  "Lifeline moves your idle AUSD into this position's margin; if the price keeps moving against you, that AUSD is at risk too.";

export const WITHDRAW_NOTE =
  "Lifeline's key can't do this. Only you can withdraw. What Lifeline can and can't do is checked on chain.";

export const PENDING_OWNER =
  "Your account is still reserved for you and Lifeline is still protecting it. Try again.";

/** Internal function names. Render `REVOKED_LABELS` instead of these. */
export const REVOKED_SELECTORS = [
  "execOrder",
  "execOrders",
  "requestDecreasePositionCollateral",
  "buyLiquidations",
  "depositCollateral",
  "allowOrderForwarding",
] as const;

export const REVOKED_LABELS = [
  "Place one order",
  "Place a batch of orders",
  "Remove margin",
  "Buy liquidations",
  "Deposit on your behalf",
  "Forward orders",
] as const;

export const WITHDRAW_AUSD = 50n * 1_000_000n;
