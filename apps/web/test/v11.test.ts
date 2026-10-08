import { describe, expect, it } from "vitest";
import { JUDGE_PATH } from "../lib/bounties";
import { TOUR_KEY, TOUR_STOPS, parseTour, tourStop } from "../lib/tour";

describe("judge tour", () => {
  it("keeps five stops in the judge path", () => {
    expect(TOUR_STOPS.map((stop) => stop.href)).toEqual(JUDGE_PATH.map((step) => step.href));
    expect(TOUR_STOPS.map((stop) => stop.title)).toEqual(JUDGE_PATH.map((step) => step.label));
    expect(TOUR_KEY).toBe("lifeline.tour");
  });

  it("resumes a saved stop and ignores a broken record", () => {
    const saved = parseTour(JSON.stringify({ active: true, stop: 2, startedAt: 10 }));
    expect(saved).toEqual({ active: true, stop: 2, startedAt: 10 });
    expect(tourStop(2)?.href).toBe("/replay");
    expect(parseTour("nope")).toBeNull();
    expect(parseTour(JSON.stringify({ active: true, stop: 9, startedAt: 1 }))).toBeNull();
  });

  it("keeps stop 3 on the whole protect flow and stop 4 on the twins", () => {
    expect(tourStop(3)?.pages).toEqual(["app"]);
    expect(tourStop(3)?.do).toBe("Open it, take ownership, sign your safety line.");
    expect(tourStop(4)?.pages).toEqual(["twins", "app"]);
    expect(tourStop(4)?.do).toBe("Withdraw some AUSD; only you can. Then open the twins.");
    expect(tourStop(1)?.do).toBe("Drag the BTC slider to −3%.");
  });
});
