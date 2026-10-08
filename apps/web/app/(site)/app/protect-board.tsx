"use client";

import { TESTNET_ID } from "@lifeline/core";
import { formatBlock, formatPrice, shortenHex } from "../../../lib/format";
import { formatAusdWhole } from "../../../lib/try-flow";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Disclosure } from "../../ui/disclosure";
import { DistanceGauge } from "../../ui/distance-gauge";
import { Field } from "../../ui/field";
import { PercentSlider } from "../../ui/percent-slider";
import { Stepper } from "../../ui/stepper";
import { TxLink } from "../../ui/tx-link";
import { TurnstileBox } from "../lifeline/turnstile-box";
import type { TryClient } from "../lifeline/e2e-client";
import { distancePctLabel, stepStates } from "../../../lib/protection";
import { TourStop } from "../../ui/tour-state";
import { Dashboard } from "./dashboard";
import { useProtection } from "./use-protection";
import "./protect.css";

const STEPS = [
  ["Practice account", "A wallet in this browser, then a reserved testnet account."],
  ["Take ownership", "One transaction. After this, only you can withdraw."],
  ["Safety line", "How far from liquidation you want to stay."],
  ["Protected", "Lifeline adds idle AUSD when the position falls inside the line."],
] as const;

export function ProtectBoard({ client }: { client: TryClient }) {
  const flow = useProtection(client);
  if (flow.phase === "protected" && !flow.receipt && flow.session) {
    return <Dashboard client={client} session={flow.session} />;
  }
  const states = stepStates(flow.phase);
  const showLine = flow.phase === "choosing" || flow.phase === "signing" || flow.phase === "demo";
  const primary =
    flow.phase === "owning"
      ? "Take ownership"
      : flow.phase === "choosing" || flow.phase === "signing" || flow.phase === "demo"
        ? "Sign and turn on protection"
        : flow.phase === "protected"
          ? "Go to your dashboard"
          : "Open my practice account";

  return (
    <div className="ui-scope">
      <main className="container protect-page">
        <TourStop page="app" />
        <header className="protect-head">
          <div>
            <h1>Protect a position</h1>
            <p className="protect-sub body-lg">
              You'll get a testnet practice account that already holds a live 15× BTC position and idle AUSD, which is the exact setup Lifeline is built for.
            </p>
          </div>
          <Badge tone="blue">Testnet</Badge>
        </header>
        <Stepper
          steps={STEPS.map(([title, help], index) => ({
            title,
            help,
            state: states[index] ?? "upcoming",
          }))}
        />
        {flow.phase === "idle" || flow.phase === "preparing" || flow.phase === "claiming" || flow.phase === "error" ? (
          <Card>
            <p>Creates a wallet in this browser. No email, no extension. Testnet only.</p>
            <TurnstileBox onToken={flow.setToken} force={flow.needsHuman} onWidget={(widget) => flow.setTurnstileReset(widget.reset)} />
          </Card>
        ) : (
          <TurnstileBox onToken={flow.setToken} force={flow.needsHuman} onWidget={(widget) => flow.setTurnstileReset(widget.reset)} />
        )}
        {flow.wallet || flow.claim ? (
          <div className="protect-checks" data-account={flow.claim?.proxy ?? ""}>
            {flow.wallet ? <p>Wallet {shortenHex(flow.wallet)}</p> : null}
            {flow.claim ? <p>Practice account reserved</p> : null}
          </div>
        ) : null}
        {flow.phase === "demo" ? (
          <Card title="Demo mode">
            <div data-testid="sandbox">
              <Badge tone="clay">Demo mode</Badge>
              <p>You're using a shared house account, so you can see protection work without a wallet. Nothing here belongs to you.</p>
            </div>
          </Card>
        ) : null}
        {flow.positionLine ? <p data-testid="position-card">{flow.positionLine}</p> : null}
        {showLine ? (
          <Card title="Safety line">
            <PercentSlider
              id="safety-line"
              label="Keep my position at least this far from liquidation"
              value={flow.safety}
              min={1}
              max={20}
              step={0.5}
              onChange={flow.changeSafety}
            />
            <p className="protect-note">Lifeline steps in below {flow.actBelow.toFixed(1)}%.</p>
            <DistanceGauge
              distancePct={flow.live ? Number(flow.live.distanceE6) / 10_000 : 0}
              actBelowPct={flow.lines.triggerBps / 100}
              safetyPct={flow.safety}
            />
            {flow.preview ? <p>{flow.preview}</p> : null}
            <p>{flow.copy}</p>
            <Disclosure title="Advanced">
              <div className="protect-advanced">
                <Field label="Act-below line" htmlFor="act-below">
                  <input
                    id="act-below"
                    className="ui-input"
                    type="number"
                    min={0.5}
                    max={19.5}
                    step={0.5}
                    value={flow.actBelow}
                    onChange={(event) => flow.changeAct(Number(event.target.value))}
                  />
                </Field>
                <Field label="Budget" htmlFor="budget">
                  <input id="budget" className="ui-input" type="number" min={1} step={1} value={flow.budgetInput} onChange={(event) => flow.setBudgetInput(event.target.value)} />
                </Field>
                <Field label="Per top-up limit" htmlFor="cap">
                  <input id="cap" className="ui-input" type="number" min={1} step={1} value={flow.capInput} onChange={(event) => flow.setCapInput(event.target.value)} />
                </Field>
                <Field label="Lasts (days)" htmlFor="days">
                  <input id="days" className="ui-input" type="number" min={1} max={30} step={1} value={flow.daysInput} onChange={(event) => flow.setDaysInput(event.target.value)} />
                </Field>
                {flow.phase === "demo" ? null : (
                  <Button variant="quiet" onClick={() => void flow.sign(true)}>
                    Test Lifeline now
                  </Button>
                )}
              </div>
            </Disclosure>
          </Card>
        ) : null}
        {flow.phase === "owning" ? (
          <Card title="This account is held for you">
            <div>
              <p>Taking ownership makes your wallet its owner. After this, only you can withdraw from it. Until you set your own line, a house safety line keeps it from liquidation.</p>
              <p className="protect-note">One transaction, paid with testnet MON we sent to your wallet.</p>
            </div>
          </Card>
        ) : null}
        {flow.phase === "protected" && flow.receipt ? (
          <article
            className="ui-card"
            data-testid="receipt"
            data-proxy={flow.claim?.proxy ?? ""}
            data-perp={flow.claim?.perpId ?? ""}
            data-target={flow.lines.targetBps}
            data-dist={flow.receipt.distAfter ?? ""}
            data-owner-txs={flow.acceptTx ? "1" : "0"}
            data-elapsed-ms={flow.elapsed}
          >
            <h3>Lifeline protected your position.</h3>
            <DistanceGauge
              distancePct={Number(flow.receipt.distAfter ?? flow.receipt.distBefore ?? "0") / 10_000}
              fromPct={flow.receipt.distBefore ? Number(flow.receipt.distBefore) / 10_000 : undefined}
              actBelowPct={flow.lines.triggerBps / 100}
              safetyPct={flow.safety}
            />
            <p>
              Distance {flow.receipt.distBefore ? distancePctLabel(flow.receipt.distBefore) : "—"} → {flow.receipt.distAfter ? distancePctLabel(flow.receipt.distAfter) : "—"}.
            </p>
            {flow.receipt.liqBefore && flow.receipt.liqAfter ? (
              <p>
                Liquidation price {formatPrice(flow.receipt.liqBefore, flow.live?.priceDecimals ?? 1)} → {formatPrice(flow.receipt.liqAfter, flow.live?.priceDecimals ?? 1)}.
              </p>
            ) : null}
            <p>Added {flow.receipt.addedCNS ? formatAusdWhole(flow.receipt.addedCNS) : "0 AUSD"} from your idle balance.</p>
            {flow.receipt.block ? <p>Confirmed in {formatBlock(flow.receipt.block)}.</p> : null}
            {flow.receipt.txHash ? <TxLink hash={flow.receipt.txHash} chainId={TESTNET_ID} linkLabel="View the top-up" /> : null}
          </article>
        ) : null}
        {flow.error ? (
          <p className="ui-field-error" role="alert">
            {flow.error}
          </p>
        ) : null}
        {flow.offerDemo ? (
          <Button variant="secondary" onClick={flow.useDemo}>
            Use demo mode
          </Button>
        ) : null}
        {flow.notice ? <p data-testid="flow-note">{flow.notice}</p> : null}
        {flow.phase !== "protected" ? (
          <Button
            variant="primary"
            data-ready={flow.ready ? "yes" : "no"}
            busy={flow.phase === "preparing" || flow.phase === "claiming" || flow.phase === "signing"}
            busyLabel={flow.phase === "preparing" ? "Creating your wallet" : flow.phase === "claiming" ? "Reserving a practice account" : "Signing"}
            onClick={() => {
              if (flow.phase === "owning") void flow.takeOwnership();
              else if (flow.phase === "choosing" || flow.phase === "demo") {
                if (flow.phase === "demo") void flow.signDemo();
                else void flow.sign(false);
              } else void flow.openPractice();
            }}
          >
            {primary}
          </Button>
        ) : (
          <div className="protect-actions">
            <Button href="/app" variant="primary">
              Go to your dashboard
            </Button>
            {flow.wallet ? (
              <Button variant="secondary" onClick={() => void flow.withdraw()}>
                Withdraw 50 AUSD
              </Button>
            ) : null}
            {flow.wallet ? (
              <Button variant="quiet" onClick={() => void flow.pause()}>
                Pause protection
              </Button>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
