import { ONE_LINER } from "../../../lib/copy";
import { TryLifeline } from "./try-lifeline";

export const metadata = { title: "Try Lifeline" };

export default function LifelinePage() {
  return (
    <main className="stage">
      <h1>Try Lifeline</h1>
      <p className="lede">{ONE_LINER}</p>
      <TryLifeline />
    </main>
  );
}
