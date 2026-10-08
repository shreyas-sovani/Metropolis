export interface ReplaySample {
  block: number;
  markPNS: string;
  distanceE6: string;
}

/** SVG of the stored marks. The act marker is the first sample already inside the trigger. */
export function ReplayChart({
  samples,
  liqPNS,
  wouldActBlock,
  liquidatedBlock,
}: {
  samples: readonly ReplaySample[];
  liqPNS: string;
  wouldActBlock: number;
  liquidatedBlock: number;
}) {
  const width = 720;
  const height = 280;
  const pad = 28;
  if (samples.length === 0) return null;
  const marks = samples.map((sample) => Number(sample.markPNS));
  const liq = Number(liqPNS);
  const trigger = liq / 0.96;
  const min = Math.min(...marks, liq, trigger);
  const max = Math.max(...marks, liq, trigger);
  const span = Math.max(1, max - min);
  const xOf = (block: number) => {
    const first = samples[0]?.block ?? block;
    const last = samples[samples.length - 1]?.block ?? block;
    const t = last === first ? 0 : (block - first) / (last - first);
    return pad + Math.min(1, Math.max(0, t)) * (width - pad * 2);
  };
  const yOf = (price: number) => pad + (1 - (price - min) / span) * (height - pad * 2);
  const line = samples.map((sample, index) => `${index === 0 ? "M" : "L"}${xOf(sample.block)},${yOf(Number(sample.markPNS))}`).join(" ");
  const actX = xOf(wouldActBlock);
  const endX = xOf(Math.min(liquidatedBlock, samples[samples.length - 1]?.block ?? liquidatedBlock));
  return (
    <svg className="replay-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Mark price into the liquidation">
      <line x1={pad} x2={width - pad} y1={yOf(liq)} y2={yOf(liq)} className="replay-liq" />
      <line x1={pad} x2={width - pad} y1={yOf(trigger)} y2={yOf(trigger)} className="replay-trigger" />
      <path d={line} className="replay-mark" />
      <line data-testid="would-act" data-block={wouldActBlock} x1={actX} x2={actX} y1={pad} y2={height - pad} className="replay-act" />
      <circle data-testid="liquidated" cx={endX} cy={yOf(marks[marks.length - 1] ?? liq)} r="5" className="replay-end" />
    </svg>
  );
}
