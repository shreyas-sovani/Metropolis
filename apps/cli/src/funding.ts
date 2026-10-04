export const WEI = 10n ** 18n;
export const AUSD_UNIT = 10n ** 6n;

export const SPONSOR_FLOOR = 3n * WEI;

export const MON_ROLES = [
  "OPERATOR",
  "POOL_OWNER",
  "MAKER",
  "CALIBRATION",
  "TEST_OWNER",
] as const;

export type MonRole = (typeof MON_ROLES)[number];

export const AUSD_ROLES = [
  "POOL_OWNER",
  "MAKER",
  "CALIBRATION",
  "TEST_OWNER",
] as const;

export type AusdRole = (typeof AUSD_ROLES)[number];

export const ALL_ROLES = [
  "SPONSOR",
  "OPERATOR",
  "POOL_OWNER",
  "MAKER",
  "CALIBRATION",
  "TEST_OWNER",
] as const;

export type Role = (typeof ALL_ROLES)[number];

/** fund:mon targets from backlog S0.5. */
export const MON_TARGETS: Record<MonRole, bigint> = {
  OPERATOR: 5n * WEI,
  POOL_OWNER: 2n * WEI,
  MAKER: WEI / 2n,
  CALIBRATION: WEI / 5n,
  TEST_OWNER: WEI / 5n,
};

/** faucet:ausd targets from backlog S0.5. */
export const AUSD_TARGETS: Record<AusdRole, bigint> = {
  POOL_OWNER: 25_000n * AUSD_UNIT,
  MAKER: 25_000n * AUSD_UNIT,
  CALIBRATION: 1_000n * AUSD_UNIT,
  TEST_OWNER: 1_000n * AUSD_UNIT,
};

/** Status floors from backlog §4.3. */
export const MON_FLOORS: Partial<Record<Role, bigint>> = {
  SPONSOR: SPONSOR_FLOOR,
  OPERATOR: 1n * WEI,
  POOL_OWNER: 1n * WEI,
  MAKER: WEI / 2n,
};

export const AUSD_FLOORS: Partial<Record<Role, bigint>> = {
  MAKER: 5_000n * AUSD_UNIT,
};

export function bumpedGas(estimate: bigint): bigint {
  return (estimate * 12n + 9n) / 10n;
}

export function formatUnits(value: bigint, decimals: number, places: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, places);
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export interface MonSend {
  role: MonRole;
  amount: bigint;
}

/**
 * Sends each role up to its target, in backlog order, without taking the
 * sponsor under its floor. `gasCost` is reserved once per send.
 */
export function planMonSends(input: {
  sponsor: bigint;
  balances: Record<MonRole, bigint>;
  gasCost: bigint;
  floor?: bigint;
}): MonSend[] {
  let sponsor = input.sponsor;
  const floor = input.floor ?? SPONSOR_FLOOR;
  const sends: MonSend[] = [];
  for (const role of MON_ROLES) {
    const have = input.balances[role];
    const target = MON_TARGETS[role];
    const need = target > have ? target - have : 0n;
    if (need === 0n) continue;
    const reserve = floor + input.gasCost;
    const available = sponsor > reserve ? sponsor - reserve : 0n;
    if (available === 0n) break;
    const amount = need < available ? need : available;
    sends.push({ role, amount });
    sponsor -= amount + input.gasCost;
  }
  return sends;
}

export interface Holdings {
  mon: Record<Role, bigint>;
  ausd: Record<Role, bigint>;
}

export function floorBreaches(holdings: Holdings): string[] {
  const lines: string[] = [];
  for (const role of ALL_ROLES) {
    const monFloor = MON_FLOORS[role];
    if (monFloor !== undefined && holdings.mon[role] < monFloor) {
      lines.push(
        `LOW: ${role} MON ${formatUnits(holdings.mon[role], 18, 4)} < ${formatUnits(monFloor, 18, 4)}`,
      );
    }
    const ausdFloor = AUSD_FLOORS[role];
    if (ausdFloor !== undefined && holdings.ausd[role] < ausdFloor) {
      lines.push(
        `LOW: ${role} AUSD ${formatUnits(holdings.ausd[role], 6, 2)} < ${formatUnits(ausdFloor, 6, 2)}`,
      );
    }
  }
  return lines;
}

export function targetShortfalls(holdings: Holdings): string[] {
  const lines: string[] = [];
  if (holdings.mon.SPONSOR < SPONSOR_FLOOR) {
    lines.push(
      `SHORT: SPONSOR MON ${formatUnits(holdings.mon.SPONSOR, 18, 4)} < ${formatUnits(SPONSOR_FLOOR, 18, 4)}`,
    );
  }
  for (const role of MON_ROLES) {
    const target = MON_TARGETS[role];
    if (holdings.mon[role] < target) {
      lines.push(
        `SHORT: ${role} MON ${formatUnits(holdings.mon[role], 18, 4)} < ${formatUnits(target, 18, 4)}`,
      );
    }
  }
  for (const role of AUSD_ROLES) {
    const target = AUSD_TARGETS[role];
    if (holdings.ausd[role] < target) {
      lines.push(
        `SHORT: ${role} AUSD ${formatUnits(holdings.ausd[role], 6, 2)} < ${formatUnits(target, 6, 2)}`,
      );
    }
  }
  return lines;
}
