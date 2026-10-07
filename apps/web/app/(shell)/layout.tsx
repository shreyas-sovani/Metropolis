import type { ReactNode } from "react";
import { HealthBanner } from "../health-banner";
import { Providers } from "../providers";

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <div className="shell">
        <header className="top">
          <div className="brand">
            <strong>Lifeline</strong>
            <svg className="trace" viewBox="0 0 148 18" aria-hidden="true">
              <path d="M0 9 H28 L36 9 L44 3 L52 15 L60 9 H92 L100 9 L108 2 L116 16 L124 9 H148" />
            </svg>
          </div>
          <nav className="nav" aria-label="Primary">
            <a href="/">Radar</a>
            <a href="/lifeline">Try it</a>
            <a href="/twins">Twins</a>
            <a href="/judges">Judges</a>
          </nav>
        </header>
        <HealthBanner />
        {children}
      </div>
    </Providers>
  );
}
