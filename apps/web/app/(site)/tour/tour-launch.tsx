"use client";

import { useEffect, useState } from "react";
import { Button } from "../../ui/button";
import { startTour } from "../../ui/tour-state";

export function TourLaunch() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <div className="tour-actions">
      <Button
        variant="primary"
        data-ready={ready ? "yes" : "no"}
        onClick={() => {
          startTour();
          window.location.assign("/radar");
        }}
      >
        Start the tour
      </Button>
      <Button variant="quiet" href="/tour/evidence">
        Go straight to the evidence
      </Button>
    </div>
  );
}
