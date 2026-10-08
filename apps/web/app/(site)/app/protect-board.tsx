"use client";

import { formatBlock } from "../../../lib/format";
import { formatAusdWhole } from "../../../lib/try-flow";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Disclosure } from "../../ui/disclosure";
import { DistanceGauge } from "../../ui/distance-gauge";
import { PercentSlider } from "../../ui/percent-slider";
import { Stepper } from "../../ui/stepper";
import { TurnstileBox } from "../lifeline/turnstile-box";
import type { TryClient } from "../lifeline/e2e-client";
import { distancePctLabel, stepStates } from "../../../lib/protection";
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
  const states = stepStates(flow.phase);
  const primary =
    flow.phase === "owning"
      ? "Take ownership"
      :     flow.phase === "choosing" || flow.phase === "signing" || flow.phase === "demo"
        ? "Sign and turn on protection"
        : flow.phase === "protected"
          ? "Go to your dashboard"
          : "Open my practice account";

  return (
    <div className="ui-scope">
      <main className="container protect-page">
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
        <TurnstileBox onToken={flow.setToken} />
        {flow.phase === "demo" ? (
          <Card title="Demo mode">
            <div data-testid="sandbox">
              <Badge tone="clay">Demo mode</Badge>
              <p>You're using a shared house account, so you can see protection work without a wallet. Nothing here belongs to you.</p>
            </div>
          </Card>
        ) : null}
        {flow.positionLine ? <p data-testid="position-card">{flow.positionLine}</p> : null}
        {flow.phase === "choosing" || flow.phase === "signing" ? (
          <Card title="Safety line">
            <PercentSlider id="safety-line" label="Keep my position at least this far from liquidation" value={flow.safety} min={2} max={15} step={0.5} onChange={flow.setSafety} />
            <p className="protect-note">Lifeline steps in below {((flow.lines.triggerBps) / 100).toFixed(1)}%.</p>
            <DistanceGauge distancePct={flow.live ? Number(flow.live.distanceE6) / 10_000 : 0} actBelowPct={flow.lines.triggerBps / 100} safetyPct={flow.safety} />
            <p>{flow.copy}</p>
            <Disclosure title="Advanced">
              <p>Per top-up limit 150 AUSD. Budget {flow.live?.freeCNS ? formatAusdWhole((BigInt(flow.live.freeCNS) / 2n).toString()) : "half your idle AUSD"}. Lasts 7 days.</p>
              <Button variant="quiet" onClick={() => void flow.sign(true)}>
                Test Lifeline now
              </Button>
            </Disclosure>
          </Card>
        ) : null}
        {flow.phase === "owning" ? (
          <Card title="This account is held for you">
            <p>Taking ownership makes your wallet its owner. After this, only you can withdraw from it. Until you set your own line, a house safety line keeps it from liquidation.</p>
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
              actBelowPct={flow.lines.triggerBps / 100}
              safetyPct={flow.safety}
            />
            <p>
              Distance {flow.receipt.distBefore ? distancePctLabel(flow.receipt.distBefore) : "—"} → {flow.receipt.distAfter ? distancePctLabel(flow.receipt.distAfter) : "—"}.
            </p>
            <p>Added {flow.receipt.addedCNS ? formatAusdWhole(flow.receipt.addedCNS) : "0 AUSD"} from your idle balance.</p>
            {flow.receipt.block ? <p>Confirmed in {formatBlock(flow.receipt.block)}.</p> : null}
          </article>
        ) : null}
        {flow.error ? <p className="ui-field-error" role="alert">{flow.error}</p> : null}
        {flow.notice ? <p>{flow.notice}</p> : null}
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
            <Button href="/app" variant="primary">Go to your dashboard</Button>
            <Button variant="secondary" onClick={() => void flow.withdraw()}>Withdraw 50 AUSD</Button>
            <Button variant="quiet" onClick={() => void flow.disarm()}>Pause protection</Button>
          </div>
        )}
      </main>
    </div>
  );
}
