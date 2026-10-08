"use client";

import { useEffect, useState } from "react";
import { formatAgo, formatBlock } from "../../lib/format";
import { useOpsHealth } from "./ops-health";
import "./heartbeat.css";

export function Heartbeat({
  armed,
  lastAlarmAt,
  lastBlock,
  pulse,
}: {
  armed?: number;
  lastAlarmAt?: number | null;
  lastBlock?: number | null;
  pulse?: boolean;
}) {
  const live = useOpsHealth();
  const count = armed ?? live.armed;
  const at = lastAlarmAt === undefined ? live.lastAlarmAt : lastAlarmAt;
  const block = lastBlock === undefined ? live.lastBlock : lastBlock;
  const beating = pulse ?? live.pulse;
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
  }, [at]);
  const noun = count === 1 ? "position" : "positions";
  let text = "Lifeline has not reported a check yet.";
  if (at !== null && now !== null) {
    const ago = formatAgo(at, now);
    const where = block === null ? "" : ` · ${formatBlock(block)}`;
    text = `Lifeline checked ${count} ${noun} ${ago}${where}`;
  } else if (at !== null) {
    const where = block === null ? "" : ` · ${formatBlock(block)}`;
    text = `Lifeline checked ${count} ${noun}${where}`;
  }
  return (
    <p className="ui-heartbeat">
      <span className={beating ? "ui-heartbeat-dot is-pulse" : "ui-heartbeat-dot"} aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
