import "./trace.css";

const PATH = "M0 9 H28 L36 9 L44 3 L52 15 L60 9 H92 L100 9 L108 2 L116 16 L124 9 H148";

export function LifelineTrace({
  height = 20,
  draw = false,
  wide = false,
}: {
  height?: number;
  draw?: boolean;
  wide?: boolean;
}) {
  const width = Math.round((height * 148) / 18);
  return (
    <svg
      className={wide ? "ui-trace ui-trace-wide" : "ui-trace"}
      width={wide ? "100%" : width}
      height={wide ? 28 : height}
      viewBox="0 0 148 18"
      preserveAspectRatio={wide ? "none" : undefined}
      aria-hidden="true"
    >
      <path d={PATH} pathLength={1} className={draw ? "ui-trace-draw" : undefined} />
    </svg>
  );
}

export const TRACE_PATH = PATH;
