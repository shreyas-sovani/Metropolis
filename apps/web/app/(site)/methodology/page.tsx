import summary from "../../../../../packages/core/test/fixtures/g4-fork-summary.json";
import { ExactBadge } from "../../exact-badge";
import { CALIBRATED } from "@lifeline/core";

export default function MethodologyPage() {
  return (
    <main className="stage">
      <h1>Contract-exact</h1>
      <ExactBadge calibrated={CALIBRATED} />
      <p className="lede">
        The liquidation price is the contract rule: raw pricePNS, premium subtracted, maintenance at lot 0, ceil for longs and floor for shorts.
      </p>
      <section className="panel" data-testid="fork-summary">
        <h2>Latest gate:4 --fork</h2>
        <p>
          {summary.date} · {summary.positions} positions · {summary.markets} markets · {summary.shorts} shorts · premium {summary.withPremium} · residue {summary.withResidue} · exact match {summary.exactMatchPct}%
        </p>
        <p>Script: pnpm cli gate:4 --fork</p>
        <p>Reproduce locally with a fork URL in the environment, then run that command. It starts anvil, checks the tick, and always kills the fork.</p>
      </section>
    </main>
  );
}
