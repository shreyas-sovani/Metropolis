"use client";

import { useEffect, useState } from "react";
import { LANDING_MS } from "../../../lib/poll";
import { Skeleton } from "../../ui/skeleton";

export function SavesCount() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let gone = false;
    async function load() {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/saves");
        if (!response.ok) return;
        const body = (await response.json()) as { count?: number };
        if (!gone) setCount(typeof body.count === "number" ? body.count : 0);
      } catch {
        /* the next poll retries */
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), LANDING_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      gone = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  if (count === null) return <Skeleton width={48} height={32} />;
  return (
    <p className="landing-saves-count tabular" data-testid="landing-saves">
      {count}
    </p>
  );
}
