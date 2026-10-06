/** Perpl splits a liquidation residual per 100,000. Mainnet BTC is 80,000 / 10,000 / 10,000. */
export const PER_100K = 100_000n;

export interface LiqSplit {
  userPer100K: bigint;
  insPer100K: bigint;
  protocolPer100K: bigint;
}

export interface ResidualSplit {
  residual: bigint;
  user: bigint;
  insurance: bigint;
  protocol: bigint;
  ok: boolean;
}

/**
 * The account credit is the user share. Invert it to the residual, then
 * apply the insurance and protocol rates. Rounding must stay within 1 CNS.
 */
export function reconstructResidual(accAmountCNS: bigint, split: LiqSplit): ResidualSplit {
  const credit = accAmountCNS > 0n ? accAmountCNS : 0n;
  if (split.userPer100K <= 0n) {
    return { residual: credit, user: credit, insurance: 0n, protocol: 0n, ok: credit === 0n };
  }
  const residual = (credit * PER_100K) / split.userPer100K;
  const user = (residual * split.userPer100K) / PER_100K;
  const insurance = (residual * split.insPer100K) / PER_100K;
  const protocol = residual - user - insurance;
  const userGap = user > credit ? user - credit : credit - user;
  return { residual, user, insurance, protocol, ok: user + insurance + protocol === residual && userGap <= 1n };
}

/** Insurance plus protocol, the part the trader forfeits. */
export function forfeitCNS(amountCNS: bigint, split: LiqSplit): bigint {
  if (amountCNS <= 0n) return 0n;
  return (amountCNS * (split.insPer100K + split.protocolPer100K)) / PER_100K;
}

export function penaltyTotals(input: {
  events: readonly { accAmountCNS: bigint; eligible: boolean }[];
  split: LiqSplit;
  atRiskDepositsCNS: readonly bigint[];
}): { paidCNS: bigint; avoidableCNS: bigint; atStakeCNS: bigint } {
  let paid = 0n;
  let avoidable = 0n;
  for (const event of input.events) {
    const part = reconstructResidual(event.accAmountCNS, input.split);
    const forfeited = part.insurance + part.protocol;
    paid += forfeited;
    if (event.eligible) avoidable += forfeited;
  }
  const atStake = input.atRiskDepositsCNS.reduce((sum, deposit) => sum + forfeitCNS(deposit, input.split), 0n);
  return { paidCNS: paid, avoidableCNS: avoidable, atStakeCNS: atStake };
}
