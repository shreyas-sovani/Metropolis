import { Lookup } from "../lookup";
import { RadarBoard } from "./radar-board";

export default function RadarPage() {
  return (
    <main className="stage">
      <RadarBoard />
      <section className="panel lookup-panel">
        <h2>Look up an account</h2>
        <p>Paste a mainnet or testnet address. Mainnet stays read-only.</p>
        <Lookup />
      </section>
    </main>
  );
}
