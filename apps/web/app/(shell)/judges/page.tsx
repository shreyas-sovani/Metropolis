import { BOUNTIES, JUDGE_PATH, proofUrl } from "../../../lib/bounties";

export default function JudgesPage() {
  return (
    <main className="stage">
      <h1>For judges</h1>
      <p className="lede">Ninety seconds: lookup, claim, twins. Each bounty below has one live proof.</p>
      <section className="panel">
        <h2>Judge path</h2>
        <ul>
          {JUDGE_PATH.map((step) => (
            <li key={step.href}>
              <a href={step.href}>{step.label}</a>
            </li>
          ))}
        </ul>
      </section>
      {BOUNTIES.map((bounty) => (
        <section className="panel" key={bounty.name}>
          <h2>{bounty.name}</h2>
          <p>{bounty.requirement}</p>
          <p>{bounty.how}</p>
          <p>
            <code>{bounty.code}</code>
          </p>
          <p>
            <a href={proofUrl(bounty.proof)}>{bounty.proofLabel}</a>
          </p>
        </section>
      ))}
    </main>
  );
}
