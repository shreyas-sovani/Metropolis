/** Largest gap between sorted tick timestamps, in milliseconds. */
export function maxGapMs(timestamps: readonly number[]): number {
  if (timestamps.length < 2) return 0;
  let gap = 0;
  for (let index = 1; index < timestamps.length; index++) {
    const left = timestamps[index - 1] ?? 0;
    const right = timestamps[index] ?? left;
    if (right - left > gap) gap = right - left;
  }
  return gap;
}

/** Gate stub. The real evaluator arrives in C6. */
export function evaluateStub(depositCNS: bigint): "skip" {
  void depositCNS;
  return "skip";
}
