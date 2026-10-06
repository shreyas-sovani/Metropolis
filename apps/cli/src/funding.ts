export const WEI = 10n ** 18n;
export const AUSD_UNIT = 10n ** 6n;

export const SPONSOR_FLOOR = 3n * WEI;

/** G7 measured costs, in wei: 0.286 per pool account, 0.097 per claim, 0.025 per top-up. */
export const POOL_ACCOUNT_MON = 286n * 10n ** 15n;
export const CLAIM_MON = 97n * 10n ** 15n;
export const TOPUP_MON = 25n * 10n ** 15n;

/** 40 accounts, 100 claims, and 400 top-ups. 31.14 MON. */
export function judgingMonBudget(accounts = 40n, claims = 100n, topups = 400n): bigint {
  return accounts * POOL_ACCOUNT_MON + claims * CLAIM_MON + topups * TOPUP_MON;
}

export function budgetLine(sponsorWei: bigint, need = judgingMonBudget()): string {
  const needText = formatUnits(need, 18, 4);
  const have = formatUnits(sponsorWei, 18, 4);
  if (sponsorWei >= need) return `budget ok need=${needText} sponsor=${have}`;
  const shortfall = formatUnits(need - sponsorWei, 18, 4);
  return `budget short need=${needText} sponsor=${have} shortfall=${shortfall}`;
}

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

export interface InFlightMon {
  role: MonRole;
  amount: bigint;
}

/** Plan the sends still required. An in-flight transfer counts as already received. */
export function remainingMonSends(input: {
  sponsor: bigint;
  balances: Record<MonRole, bigint>;
  gasCost: bigint;
  inFlight?: InFlightMon | null;
  floor?: bigint;
}): MonSend[] {
  const balances = { ...input.balances };
  let sponsor = input.sponsor;
  const inFlight = input.inFlight;
  if (inFlight && inFlight.amount > 0n) {
    balances[inFlight.role] += inFlight.amount;
    sponsor -= inFlight.amount + input.gasCost;
  }
  return planMonSends({
    sponsor,
    balances,
    gasCost: input.gasCost,
    floor: input.floor,
  });
}

export function nextFaucetRole(
  balances: Record<AusdRole, bigint>,
  inFlight: AusdRole | null,
): AusdRole | null {
  if (inFlight) return null;
  return AUSD_ROLES.find((role) => balances[role] < AUSD_TARGETS[role]) ?? null;
}

export interface FloorOverride {
  role: Role;
  asset: "MON" | "AUSD";
  amount: bigint;
}

/** `ROLE:MON:12.5` or `ROLE:AUSD:5000`, in whole tokens. */
export function parseFloorSpec(spec: string): FloorOverride {
  const [role, asset, raw] = spec.split(":");
  if (!role || !ALL_ROLES.includes(role as Role)) throw new Error(`bad floor role in ${spec}`);
  if (asset !== "MON" && asset !== "AUSD") throw new Error(`bad floor asset in ${spec}`);
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) throw new Error(`bad floor amount in ${spec}`);
  const [whole, frac = ""] = raw.split(".");
  const decimals = asset === "MON" ? 18 : 6;
  const fraction = (frac ?? "").padEnd(decimals, "0").slice(0, decimals);
  const scale = 10n ** BigInt(decimals);
  const amount = BigInt(whole ?? "0") * scale + BigInt(fraction === "" ? "0" : fraction);
  return { role: role as Role, asset, amount };
}

export function floorBreaches(holdings: Holdings, overrides: readonly FloorOverride[] = []): string[] {
  const monFloors: Partial<Record<Role, bigint>> = { ...MON_FLOORS };
  const ausdFloors: Partial<Record<Role, bigint>> = { ...AUSD_FLOORS };
  for (const override of overrides) {
    if (override.asset === "MON") monFloors[override.role] = override.amount;
    else ausdFloors[override.role] = override.amount;
  }
  const lines: string[] = [];
  for (const role of ALL_ROLES) {
    const monFloor = monFloors[role];
    if (monFloor !== undefined && holdings.mon[role] < monFloor) {
      lines.push(
        `LOW: ${role} MON ${formatUnits(holdings.mon[role], 18, 4)} < ${formatUnits(monFloor, 18, 4)}`,
      );
    }
    const ausdFloor = ausdFloors[role];
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
