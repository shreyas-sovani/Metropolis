import {
  HEALTH_FIELDS,
  LIQUIDATION_FIELDS,
  RISK_ACCOUNT_FIELDS,
  RISK_LIMIT,
  RISK_PARAMS,
  RISK_POSITION_FIELDS,
} from "../../../lib/api-docs";
import { FieldTable } from "./field-table";
import { RiskRunner } from "./risk-runner";
import "./developers.css";

export const metadata = {
  title: "Developers",
  description: "A free risk endpoint for anyone building on Perpl.",
};

export default function DevelopersPage() {
  return (
    <div className="ui-scope">
      <main className="container dev-page">
        <header>
          <h1>Developers</h1>
          <p className="dev-sub body-lg">A free risk endpoint for anyone building on Perpl.</p>
        </header>
        <section className="dev-section" aria-labelledby="risk-api">
          <h2 id="risk-api">Risk API</h2>
          <p>
            <code>GET /api/v1/risk/{"{address}"}?chain=143</code>
          </p>
          <p>
            Use <code>chain=10143</code> for testnet. {RISK_LIMIT} calls a minute per IP. CORS is open: any site can call it.
          </p>
          <h3>Parameters</h3>
          <FieldTable caption="Risk API parameters" rows={RISK_PARAMS} />
          <h3>Account</h3>
          <FieldTable caption="Risk API account fields" rows={RISK_ACCOUNT_FIELDS} />
          <h3>Each position</h3>
          <FieldTable caption="Risk API position fields" rows={RISK_POSITION_FIELDS} />
          <RiskRunner />
        </section>
        <section className="dev-section" aria-labelledby="liquidations">
          <h2 id="liquidations">Liquidation history</h2>
          <p>
            <code>GET /api/liquidations</code> is the last 30 days of mainnet liquidations. Amounts are micro-dollars.
          </p>
          <FieldTable caption="Liquidation history fields" rows={LIQUIDATION_FIELDS} />
        </section>
        <section className="dev-section" id="status" aria-labelledby="status-heading">
          <h2 id="status-heading">Status</h2>
          <p>
            <code>GET /health</code> on the protection service. The pill in the header reads the same check.
          </p>
          <FieldTable caption="Health fields" rows={HEALTH_FIELDS} />
        </section>
      </main>
    </div>
  );
}
