import { TOUR_STOPS } from "../../../lib/tour";
import { TourLaunch } from "./tour-launch";
import "./tour.css";

export const metadata = {
  title: "The 3-minute tour",
  description: "Five stops. Every number is live and every transaction is real.",
};

export default function TourPage() {
  return (
    <div className="ui-scope">
      <main className="container tour-page">
        <header>
          <h1>The 3-minute tour</h1>
          <p className="tour-sub body-lg">Five stops. Every number is live and every transaction is real.</p>
        </header>
        <ol className="tour-list">
          {TOUR_STOPS.map((stop) => (
            <li key={stop.id}>
              <a href={stop.href}>
                {stop.id}. {stop.title}
              </a>
              <p>{stop.sentence}</p>
            </li>
          ))}
        </ol>
        <TourLaunch />
      </main>
    </div>
  );
}
