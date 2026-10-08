import { TESTNET_ID } from "@lifeline/core";
import { PRACTICE_ACCOUNT } from "../../../lib/bounties";
import { addressUrl } from "../../../lib/explorer";
import { Card } from "../../ui/card";
import { SavesCount } from "../landing/saves-count";
import "./proof.css";

const CANT = [
  "Place or cancel orders (single or batch)",
  "Remove margin",
  "Buy liquidations",
  "Deposit on your behalf",
  "Forward orders",
];

export const metadata = {
  title: "Proof",
  description: "Everything here links to a transaction or a file you can check yourself.",
};

export default function ProofPage() {
  return (
    <div className="ui-scope">
      <main className="container proof-page">
        <header>
          <h1>Proof</h1>
          <p className="proof-sub body-lg">Everything here links to a transaction or a file you can check yourself.</p>
        </header>
        <div className="proof-grid">
          <Card title="Twins">
            <p>Same trade, opened twice. One has Lifeline.</p>
            <p><a href="/twins">Open the twin pairs</a></p>
          </Card>
          <Card title="A real liquidation">
            <p>A real Bitcoin long liquidated on mainnet, and what Lifeline would have added.</p>
            <p><a href="/replay">Open the replay</a></p>
          </Card>
          <Card title="Contract-exact">
            <p>Our liquidation price matches Perpl's contract to the tick on 912 live positions.</p>
            <p><a href="/methodology">Open the method</a></p>
          </Card>
          <Card title="Saves">
            <p>Positions still open after the market crossed the liquidation price they had before Lifeline's top-up.</p>
            <SavesCount />
          </Card>
          <Card title="What Lifeline's key can't do">
            <ul className="proof-cant">
              {CANT.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p>
              <a href={addressUrl(TESTNET_ID, PRACTICE_ACCOUNT)}>Checked on a practice account</a>
            </p>
          </Card>
        </div>
      </main>
    </div>
  );
}
