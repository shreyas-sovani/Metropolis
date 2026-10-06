export function calibrationMark(calibrated: boolean): { kind: "exact" | "est"; label: string } {
  return calibrated ? { kind: "exact", label: "Contract-exact" } : { kind: "est", label: "est." };
}
