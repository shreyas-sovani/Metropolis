export interface RefillInventory {
  available: number;
  long: number;
  short: number;
  inBand: number;
}

export interface RefillTarget {
  available: number;
  perSide: number;
  inBand: number;
}

export const DEFAULT_MAX_NEW = 4;

/** Exit before any send when the register step would fail. */
export function refillPreflight(adminSecret: string, workerUrl: string): string | null {
  if (!adminSecret.trim()) return "ADMIN_SECRET missing";
  if (!workerUrl.trim().startsWith("https://")) return "worker url missing";
  return null;
}

export function createsAllowed(created: number, maxNew: number): boolean {
  return created < maxNew;
}

/** The next side to open, or null when every target is already met. */
export function nextRefillSide(inventory: RefillInventory, target: RefillTarget): "long" | "short" | null {
  const met =
    inventory.available >= target.available &&
    inventory.long >= target.perSide &&
    inventory.short >= target.perSide &&
    inventory.inBand >= target.inBand;
  if (met) return null;
  if (inventory.long < target.perSide && inventory.long <= inventory.short) return "long";
  if (inventory.short < target.perSide) return "short";
  return inventory.long <= inventory.short ? "long" : "short";
}
