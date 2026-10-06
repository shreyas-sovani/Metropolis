export default function JudgesPage() {
  return (
    <main className="stage">
      <h1>For judges</h1>
      <p className="lede" data-testid="saves">
        Saves are counted only when a later mark crosses the pre-top-up liquidation price and the position stays open. The counter is 0 when none have been recorded.
      </p>
      <section className="panel">
        <h2>Risk API</h2>
        <p>Open to integrators. 60 requests a minute per IP.</p>
        <pre>curl &quot;$ORIGIN/api/v1/risk/0x77A89C51f106D6cD547542a3A83FE73cB4459135?chain=143&quot;</pre>
      </section>
    </main>
  );
}
