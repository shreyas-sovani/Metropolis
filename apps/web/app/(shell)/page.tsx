import { Lookup } from "../lookup";

export default function RadarPage() {
  return (
    <main className="stage">
      <h1>Where the book can break</h1>
      <p className="lede">
        Lifeline keeps Perpl positions from being liquidated while money sits idle next to them.
      </p>
      <section className="grid">
        <article className="panel">
          <h2>Radar</h2>
          <p>Open interest, at-risk margin, and the marks that would close them. The live map fills in next.</p>
        </article>
        <article className="panel">
          <h2>Look up an account</h2>
          <p>Paste a mainnet or testnet address. Mainnet stays read-only.</p>
          <Lookup />
        </article>
      </section>
    </main>
  );
}
