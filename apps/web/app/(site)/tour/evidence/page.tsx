import summary from "../../../../../../packages/core/test/fixtures/g4-fork-summary.json";
import { BOUNTIES, proofUrl } from "../../../../lib/bounties";
import { Card } from "../../../ui/card";
import { TourStop } from "../../../ui/tour-state";
import { KeyNumbers } from "../key-numbers";
import "../tour.css";

export const metadata = {
  title: "Evidence",
  description: "Each bounty, with how Lifeline meets it and a proof you can open.",
};

export default function EvidencePage() {
  return (
    <div className="ui-scope">
      <main className="container tour-page">
        <TourStop page="evidence" />
        <header>
          <h1>Evidence</h1>
          <p className="tour-sub body-lg">Each bounty, with how Lifeline meets it and a proof you can open.</p>
        </header>
        <Card title="Key numbers">
          <KeyNumbers exactMatchPct={summary.exactMatchPct} />
        </Card>
        <div className="tour-grid">
          {BOUNTIES.map((bounty) => (
            <Card key={bounty.name} title={bounty.name}>
              <p>{bounty.requirement}</p>
              <p>{bounty.how}</p>
              <p>
                <code className="tour-code">{bounty.code}</code>
              </p>
              <p>
                <a href={proofUrl(bounty.proof)}>{bounty.proofLabel}</a>
                {bounty.also ? (
                  <>
                    {" · "}
                    <a href={proofUrl(bounty.also.href)}>{bounty.also.label}</a>
                  </>
                ) : null}
              </p>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
