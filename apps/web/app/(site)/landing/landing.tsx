import Link from "next/link";
import { TESTNET_ID, addressUrl, txUrl } from "../../../lib/explorer";
import {
  CAN,
  CANT,
  CHECKED_ACCOUNT,
  CHECKED_TOPUP,
  FAQ,
  H1,
  HOW,
  PRIMARY,
  PROBLEM_QUOTE,
  PROBLEM_SOURCE,
  PROOF,
  SAVES_BODY,
  SECURITY_HEADING,
  SUB,
  TOUR_LINK,
} from "../../../lib/landing";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Disclosure } from "../../ui/disclosure";
import { Heartbeat } from "../../ui/heartbeat";
import { LifelineTrace } from "../../ui/trace";
import { HeroCheck } from "./hero-check";
import { LiveStrip } from "./live-strip";
import { ProblemDiagram } from "./problem-diagram";
import { SavesCount } from "./saves-count";
import "./landing.css";

export function Landing() {
  return (
    <div className="ui-scope">
      <main className="landing">
        <section className="landing-hero">
          <div className="container">
            <h1 className="display">{H1}</h1>
            <p className="body-lg prose landing-sub">{SUB}</p>
            <div className="landing-actions">
              <Button href="/app" variant="primary" prefetch={false}>
                {PRIMARY}
              </Button>
              <HeroCheck />
            </div>
            <p className="landing-tour">
              <Link href="/tour" prefetch={false}>
                {TOUR_LINK}
              </Link>
            </p>
            <div className="landing-lifeline">
              <LifelineTrace wide draw />
              <Heartbeat />
            </div>
          </div>
        </section>

        <LiveStrip />

        <section className="section" aria-labelledby="problem-heading">
          <div className="container">
            <p className="micro landing-kicker">The problem</p>
            <h2 id="problem-heading" className="prose">
              {PROBLEM_QUOTE}
            </h2>
            <p className="landing-source">{PROBLEM_SOURCE}</p>
            <ProblemDiagram />
          </div>
        </section>

        <section className="section landing-how" id="how" aria-labelledby="how-heading">
          <div className="container">
            <h2 id="how-heading">How it works</h2>
            <ol className="landing-steps">
              {HOW.map((step, index) => (
                <li key={step.title}>
                  <span className="landing-step-no">{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section" id="security" aria-labelledby="security-heading">
          <div className="container">
            <h2 id="security-heading">{SECURITY_HEADING}</h2>
            <div className="landing-split">
              <Card title="Can">
                <p>{CAN}</p>
              </Card>
              <Card title="Can't">
                <p>{CANT}</p>
              </Card>
            </div>
            <p className="landing-checked">
              <a href={addressUrl(TESTNET_ID, CHECKED_ACCOUNT)}>Checked on chain</a>
              <a href={txUrl(TESTNET_ID, CHECKED_TOPUP)}>A margin top-up</a>
            </p>
          </div>
        </section>

        <section className="section" aria-labelledby="proof-heading">
          <div className="container">
            <h2 id="proof-heading">Proof</h2>
            <div className="landing-proof">
              {PROOF.map((card) => (
                <Card key={card.title} title={card.title}>
                  <p>{card.body}</p>
                  <a href={card.href}>{card.link}</a>
                </Card>
              ))}
              <Card title="Saves">
                <SavesCount />
                <p>{SAVES_BODY}</p>
                <a href="/proof">Open the proof</a>
              </Card>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="ways-heading">
          <div className="container">
            <h2 id="ways-heading">Two ways in</h2>
            <div className="landing-split">
              <Card title="For traders">
                <p>Check an address, or open a practice account.</p>
                <p className="landing-links">
                  <a href="/check">Check an address</a>
                  <a href="/app">Open a practice account</a>
                </p>
              </Card>
              <Card title="For judges">
                <p>Take the tour, then open the evidence.</p>
                <p className="landing-links">
                  <a href="/tour">Take the tour</a>
                  <a href="/tour/evidence">Open the evidence</a>
                </p>
              </Card>
            </div>
          </div>
        </section>

        <section className="section" id="faq" aria-labelledby="faq-heading">
          <div className="container landing-faq-wrap">
            <h2 id="faq-heading">FAQ</h2>
            <div className="landing-faq">
              {FAQ.map((item) => (
                <Disclosure key={item.q} title={item.q}>
                  <p>{item.a}</p>
                  {item.href && item.link ? <a href={item.href}>{item.link}</a> : null}
                </Disclosure>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-close">
          <div className="container">
            <div className="landing-close-panel">
              <h2>Use the idle AUSD already in the account.</h2>
              <p className="prose">Open a practice account on testnet. It already holds a position and idle AUSD.</p>
              <Button href="/app" variant="primary" prefetch={false}>
                {PRIMARY}
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
