"use client";

import { useEffect, useState } from "react";
import { TOUR_KEY, TOUR_STOPS, readTourStorage, tourStop, type TourPage, type TourState } from "../../lib/tour";
import { Card } from "./card";
import { TourRail } from "./tour-rail";
import "./tour-stop.css";

const EVENT = "lifeline-tour";

function writeTour(state: TourState): void {
  localStorage.setItem(TOUR_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(EVENT));
}

export function useTour(): TourState | null {
  const [state, setState] = useState<TourState | null>(null);
  useEffect(() => {
    const read = () => setState(readTourStorage(localStorage));
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return state;
}

export function startTour(): TourState {
  const state = { active: true, stop: 1, startedAt: Date.now() };
  writeTour(state);
  return state;
}

export function TourHost() {
  const tour = useTour();
  if (!tour?.active) return null;
  const stop = tourStop(tour.stop);
  if (!stop) return null;
  const go = (next: number) => {
    const dest = tourStop(next);
    if (!dest) return;
    writeTour({ ...tour, active: true, stop: next });
    window.location.assign(dest.href);
  };
  return (
    <TourRail
      stop={tour.stop}
      total={TOUR_STOPS.length}
      title={stop.title}
      backDisabled={tour.stop <= 1}
      nextDisabled={tour.stop >= TOUR_STOPS.length}
      onBack={() => go(tour.stop - 1)}
      onNext={() => go(tour.stop + 1)}
      onExit={() => writeTour({ ...tour, active: false })}
    />
  );
}

export function TourStop({ page }: { page: TourPage }) {
  const tour = useTour();
  if (!tour?.active) return null;
  const stop = tourStop(tour.stop);
  if (!stop || !stop.pages.includes(page)) return null;
  return (
    <div className="tour-stop" data-testid="tour-stop" data-stop={stop.id}>
      <Card title={stop.title}>
        <p>
          <span className="tour-k">What you're seeing. </span>
          {stop.what}
        </p>
        {stop.do ? (
          <p>
            <span className="tour-k">Do this. </span>
            {stop.do}
          </p>
        ) : null}
        <p>
          <span className="tour-k">Why it matters. </span>
          {stop.why}
        </p>
        <p>
          <span className="tour-k">Check it yourself. </span>
          {stop.checks.map((check, index) => (
            <span key={check.href}>
              {index > 0 ? " · " : null}
              <a href={check.href}>{check.label}</a>
            </span>
          ))}
        </p>
      </Card>
    </div>
  );
}
