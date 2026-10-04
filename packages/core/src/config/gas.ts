/**
 * Explicit gas limits. Monad charges the limit, so each value is
 * ceil(max observed gasUsed × 1.2) from the G6/G7 runs.
 */
export const GAS_LIMITS: Readonly<Record<string, bigint>> = Object.freeze({
  factoryCreate: 1_074_611n,
  ausdTransfer: 104_986n,
  createAccount: 434_469n,
  setOperatorAllowlist: 104_217n,
  execOrderOpen: 625_452n,
  increasePositionCollateral: 253_191n,
  transferOwnership: 129_406n,
  acceptOwnership: 108_076n,
  withdrawCollateral: 341_734n,
  monDrip: 36_000n,
  faucetRequestFunds: 163_390n,
});
