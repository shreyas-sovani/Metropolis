import "./trace.css";

const PATH = "M0 9 H28 L36 9 L44 3 L52 15 L60 9 H92 L100 9 L108 2 L116 16 L124 9 H148";

export function LifelineTrace({ height = 20, draw = false }: { height?: number; draw?: boolean }) {
  const width = Math.round((height * 148) / 18);
  return (
    <svg className="ui-trace" width={width} height={height} viewBox="0 0 148 18" aria-hidden="true">
      <path d={PATH} pathLength={1} className={draw ? "ui-trace-draw" : undefined} />
    </svg>
  );
}

export const TRACE_PATH = PATH;
