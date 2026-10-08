import { CALIBRATED } from "@lifeline/core";
import summary from "../../../../../packages/core/test/fixtures/g4-fork-summary.json";
import { Card } from "../../ui/card";
import { Stat } from "../../ui/stat";
import "./methodology.css";

export const metadata = { title: "Contract-exact" };

export default function MethodologyPage() {
  return (
    <div className="ui-scope">
      <main className="container method-page">
        <header>
          <h1>Contract-exact</h1>
          <p className="method-sub body-lg">
            Lifeline computes the liquidation price the same way Perpl's contract does, and rounds one tick toward safety.
          </p>
        </header>
        <Card title="The formula">
          <pre>
            <code>{`entry = pricePNS / 10^priceDecimals
liq   = entry + side * (maintenance - deposit - premium) / size
tick  = ceil for longs, floor for shorts`}</code>
          </pre>
        </Card>
        <Card title="The fork check">
          <div className="method-stats" data-testid="fork-summary">
            <Stat label="Positions" value={String(summary.positions)} />
            <Stat label="Markets" value={String(summary.markets)} />
            <Stat label="Shorts" value={String(summary.shorts)} />
            <Stat label="With premium" value={String(summary.withPremium)} />
            <Stat label="With residue" value={String(summary.withResidue)} />
            <Stat label="Exact match" value={`${summary.exactMatchPct}%`} hint={summary.date} />
          </div>
          <p>{CALIBRATED ? "Calibrated against the contract." : "Not calibrated."}</p>
        </Card>
        <Card title="Reproduce it">
          <pre>
            <code>pnpm cli gate:4 --fork</code>
          </pre>
        </Card>
      </main>
    </div>
  );
}
