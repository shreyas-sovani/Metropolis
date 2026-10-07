import { TwinsPanel } from "./twins-panel";

export const metadata = { title: "Twins" };

export default function TwinsPage() {
  return (
    <main className="stage">
      <h1>Twins</h1>
      <p className="lede">Each pair is the same trade. One has a mandate. One does not. The badge says which one is still alive.</p>
      <TwinsPanel />
    </main>
  );
}
