import "./site-footer.css";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer-grid">
        <nav aria-label="Product">
          <p className="micro">Product</p>
          <a href="/app">Protect a position</a>
          <a href="/radar">Market risk</a>
          <a href="/check">Check an address</a>
          <a href="/developers">Developers</a>
        </nav>
        <nav aria-label="Proof">
          <p className="micro">Proof</p>
          <a href="/twins">Twins</a>
          <a href="/replay">A real liquidation</a>
          <a href="/methodology">Methodology</a>
          <a href="/tour">Judge tour</a>
          <a href="/tour/evidence">Evidence</a>
        </nav>
        <nav aria-label="About">
          <p className="micro">About</p>
          <a href="/#how">How it works</a>
          <a href="/#security">Security</a>
          <a href="/#faq">FAQ</a>
          <p>Built for Monad Metropolis.</p>
        </nav>
      </div>
      <div className="container">
        <p className="site-footer-note">
          Lifeline runs protection on Monad testnet. Market data is read live from Monad mainnet and never written to. Testnet tokens have no value.
        </p>
      </div>
    </footer>
  );
}
