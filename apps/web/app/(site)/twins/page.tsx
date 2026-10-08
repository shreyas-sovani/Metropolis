import { TourStop } from "../../ui/tour-state";
import { TwinsPanel } from "./twins-panel";
import "./twins.css";

export const metadata = { title: "Twins" };

export default function TwinsPage() {
  return (
    <div className="ui-scope">
      <main className="container twins-page">
        <TourStop page="twins" />
        <header>
          <h1>Twins</h1>
          <p className="twins-sub body-lg">
            Each pair is the same trade opened at the same time, price, and leverage. One has Lifeline. One doesn't.
          </p>
        </header>
        <TwinsPanel />
      </main>
    </div>
  );
}
