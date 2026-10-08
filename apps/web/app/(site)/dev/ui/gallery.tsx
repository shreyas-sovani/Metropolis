"use client";

import { useState } from "react";
import { userMessage } from "../../../../lib/messages";
import { AddressChip } from "../../../ui/address-chip";
import { Badge } from "../../../ui/badge";
import { Button } from "../../../ui/button";
import { Card } from "../../../ui/card";
import { ContractExactBadge } from "../../../ui/contract-exact-badge";
import { Disclosure } from "../../../ui/disclosure";
import { DistanceGauge } from "../../../ui/distance-gauge";
import { EmptyState } from "../../../ui/empty-state";
import { ErrorState } from "../../../ui/error-state";
import { Field } from "../../../ui/field";
import { Heartbeat } from "../../../ui/heartbeat";
import { PercentSlider } from "../../../ui/percent-slider";
import { Select } from "../../../ui/select";
import { Skeleton } from "../../../ui/skeleton";
import { Stat } from "../../../ui/stat";
import { Input } from "../../../ui/input";
import { Stepper } from "../../../ui/stepper";
import { Timeline } from "../../../ui/timeline";
import { useToast } from "../../../ui/toast";
import { TourRail } from "../../../ui/tour-rail";
import { LifelineTrace } from "../../../ui/trace";
import { TxLink } from "../../../ui/tx-link";

const SAMPLE_AT = 1_759_800_000_000;

export function Gallery() {
  const [shock, setShock] = useState(4.5);
  const toast = useToast();
  const above = userMessage("ABOVE_TRIGGER", { distancePct: "3.2%", actBelowPct: "4.5%" });
  const rate = userMessage("rate");
  return (
    <div className="ui-scope">
      <div className="container section" style={{ display: "grid", gap: 48 }}>
        <header>
          <h1>Interface</h1>
          <p className="prose body-lg">Every component and state used across Lifeline.</p>
        </header>

        <section>
          <h2>Signature</h2>
          <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
            <LifelineTrace height={36} draw />
            <Heartbeat armed={41} lastAlarmAt={SAMPLE_AT} lastBlock={68909759} pulse={false} />
          </div>
        </section>

        <section>
          <h2>Buttons</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 16 }}>
            <Button variant="primary">Protect a position</Button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
            <Button variant="secondary">Check an address</Button>
            <Button variant="quiet">Judge tour</Button>
            <Button variant="primary" disabled>
              Protect a position
            </Button>
            <Button variant="primary" busy busyLabel="Taking ownership…">
              Take ownership
            </Button>
          </div>
        </section>

        <section>
          <h2>Status and badges</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 16 }}>
            <Badge>Mainnet · read-only</Badge>
            <Badge tone="clay">Paused</Badge>
            <Badge tone="olive">On</Badge>
            <Badge tone="blue">Testnet</Badge>
            <Badge tone="danger">Demo mode</Badge>
            <ContractExactBadge calibrated />
            <ContractExactBadge calibrated={false} />
          </div>
        </section>

        <section>
          <h2>Cards and stats</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginTop: 16 }}>
            <Card title="Open interest" meta="Mainnet">
              <Stat label="Notional" value="$3.15M" hint="Live from the book" />
            </Card>
            <Card>
              <Stat label="At risk" value="12" hint="Within 4.5% of liquidation" />
            </Card>
          </div>
        </section>

        <section>
          <h2>Fields</h2>
          <div style={{ display: "grid", gap: 16, maxWidth: 480, marginTop: 16 }}>
            <Field label="Perpl account" htmlFor="gallery-address" error="That address isn't a Perpl account.">
              <Input id="gallery-address" mono defaultValue="0x1234" aria-invalid="true" aria-describedby="gallery-address-error" />
            </Field>
            <Field label="Market" htmlFor="gallery-market">
              <Select id="gallery-market" defaultValue="BTC">
                <option>BTC</option>
                <option>ETH</option>
              </Select>
            </Field>
            <PercentSlider
              id="gallery-shock"
              label="Price move"
              value={shock}
              min={0}
              max={15}
              onChange={setShock}
              preview="A 4.5% drop liquidates the positions inside the clay line."
            />
          </div>
        </section>

        <section>
          <h2>Progress</h2>
          <div style={{ display: "grid", gap: 24, marginTop: 16 }}>
            <Stepper
              steps={[
                { title: "Practice account", help: "Reserved on testnet.", state: "done" },
                { title: "Take ownership", help: "Your wallet becomes the owner.", state: "current" },
                { title: "Turn protection on", help: "Lifeline watches the distance.", state: "upcoming" },
                { title: "Top-up", help: "This one did not send.", state: "failed" },
              ]}
            />
            <DistanceGauge distancePct={3.2} actBelowPct={4.5} safetyPct={6.5} />
          </div>
        </section>

        <section>
          <h2>Activity</h2>
          <Timeline
            rows={[
              {
                title: "Top-up",
                sentence: "Lifeline added 152 AUSD to margin.",
                at: SAMPLE_AT,
                hash: "0x96442cfb00000000000000000000000000000000000000000000000000000000",
                chainId: 10143,
              },
            ]}
          />
          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            <AddressChip address="0x36DF02ca0E9B1644e181342A795556a66eB28b10" chainId={10143} />
            <TxLink hash="0xdaf150e500000000000000000000000000000000000000000000000000000000" chainId={143} />
          </div>
        </section>

        <section>
          <h2>Feedback</h2>
          <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
            <Button variant="secondary" onClick={() => toast("Transaction sent")}>
              Show a toast
            </Button>
            <div aria-hidden="true">
              <Skeleton height={16} />
              <div style={{ height: 8 }} />
              <Skeleton width="60%" height={16} />
            </div>
            <p className="sr">Loading</p>
            <EmptyState
              title="No open position"
              sentence="Check another address, or protect a practice account."
              action="Protect a position"
              href="/app"
            />
            <ErrorState title={rate.title} sentence={rate.sentence} action={rate.action} href="/app" />
            <ErrorState title={above.title} sentence={above.sentence} />
          </div>
        </section>

        <section>
          <h2>Tour and disclosure</h2>
          <div style={{ display: "grid", gap: 16, marginTop: 16 }}>
            <TourRail inline stop={2} total={5} title="A real liquidation" />
            <Disclosure title="Advanced">
              <p>The act-below line and the safety line start from the distance on this position.</p>
            </Disclosure>
          </div>
        </section>
      </div>
    </div>
  );
}
