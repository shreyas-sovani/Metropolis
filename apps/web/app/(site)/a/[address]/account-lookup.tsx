"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getAddress, isAddress } from "viem";
import {
  ACT_BELOW_PCT,
  MAINNET_ACTION,
  NO_POSITIONS,
  PRACTICE_ACTION,
  SAFETY_PCT,
  accountOutcome,
  cardModel,
  chainBadge,
  noAccountSentence,
  readPracticeProxy,
  reportAction,
  summaryFigures,
  type AccountPayload,
  type ReportPosition,
} from "../../../../lib/report";
import { Badge } from "../../../ui/badge";
import { Button } from "../../../ui/button";
import { DistanceGauge } from "../../../ui/distance-gauge";
import { ErrorState } from "../../../ui/error-state";
import { Skeleton } from "../../../ui/skeleton";
import { Stat } from "../../../ui/stat";
import { AddressChip } from "../../../ui/address-chip";
import { ExampleLinks } from "../../check/example-links";
import "../../check/check.css";
import "./report.css";

type Status = "loading" | "invalid" | "error" | "missing" | "flat" | "ready";

export function AccountLookup({ params }: { params: Promise<{ address: string }> }) {
  const search = useSearchParams();
  const mainnet = search.get("chain") !== "10143";
  const chain = mainnet ? "143" : "10143";
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [body, setBody] = useState<AccountPayload | null>(null);
  const [practice, setPractice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (mainnet) return;
    let gone = false;
    void readPracticeProxy().then((proxy) => {
      if (!gone) setPractice(proxy);
    });
    return () => {
      gone = true;
    };
  }, [mainnet]);

  useEffect(() => {
    let gone = false;
    void params.then(async ({ address: value }) => {
      let raw = value;
      try {
        raw = decodeURIComponent(value);
      } catch {
        raw = value;
      }
      if (!isAddress(raw)) {
        if (!gone) {
          setAddress(raw);
          setStatus("invalid");
          setBody(null);
        }
        return;
      }
      const checksum = getAddress(raw);
      if (!gone) {
        setAddress(checksum);
        setStatus("loading");
      }
      try {
        const response = await fetch(`/api/account/${checksum}?chain=${chain}`);
        if (gone) return;
        if (!response.ok) {
          setStatus("error");
          setBody(null);
          return;
        }
        const payload = (await response.json()) as AccountPayload;
        if (gone) return;
        setBody(payload);
        setStatus(accountOutcome(payload));
      } catch {
        if (!gone) {
          setStatus("error");
          setBody(null);
        }
      }
    });
    return () => {
      gone = true;
    };
  }, [params, chain, attempt]);

  const positions = body?.positions ?? [];
  const summary = body && (status === "ready" || status === "flat") ? summaryFigures({ idleMicro: body.idleMicro, positions }) : null;
  const action = isAddress(address) ? reportAction({ mainnet, address, practice }) : null;
  const showExamples = status === "invalid" || status === "missing" || status === "flat";

  return (
    <div className="ui-scope">
      <main className="container report-page">
        <header className="report-head">
          <h1>Risk report</h1>
          {isAddress(address) ? (
            <div className="report-identity">
              <AddressChip address={address} chainId={mainnet ? 143 : 10143} />
              <Badge tone={mainnet ? "neutral" : "blue"}>{chainBadge(mainnet)}</Badge>
            </div>
          ) : null}
          {summary ? (
            <div className="report-summary">
              <Stat label="Idle AUSD" value={summary.idle} testId="idle-ausd" />
              <Stat label="Positions" value={summary.positions} testId="position-count" />
              <Stat label="Margin" value={summary.margin} testId="total-margin" />
            </div>
          ) : null}
        </header>

        {status === "loading" ? (
          <div className="report-list" aria-busy="true">
            <Skeleton height={160} />
            <Skeleton height={160} />
          </div>
        ) : null}

        {status === "invalid" ? (
          <p className="ui-field-error" role="alert">
            That isn't a valid address.
          </p>
        ) : null}

        {status === "error" ? (
          <ErrorState
            title="The chain didn't answer."
            sentence="The account couldn't be read. Try again."
            action="Try again"
            onAction={() => setAttempt((value) => value + 1)}
          />
        ) : null}

        {status === "missing" ? (
          <div className="ui-state">
            <h3>{noAccountSentence(mainnet)}</h3>
          </div>
        ) : null}

        {status === "flat" ? (
          <div className="ui-state">
            <h3>{NO_POSITIONS}</h3>
          </div>
        ) : null}

        {status === "ready" ? (
          <div className="report-list">
            {positions.map((position, index) => (
              <PositionCard key={position.perpId} position={position} mainnet={mainnet} action={action} primary={index === 0} />
            ))}
          </div>
        ) : null}

        {showExamples ? (
          <div className="report-list">
            <ExampleLinks />
            <Button href="/app" variant="secondary" prefetch={false}>
              {mainnet ? MAINNET_ACTION : PRACTICE_ACTION}
            </Button>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function PositionCard({
  position,
  mainnet,
  action,
  primary,
}: {
  position: ReportPosition;
  mainnet: boolean;
  action: { label: string; href: "/app" } | null;
  primary: boolean;
}) {
  const card = cardModel(position, mainnet);
  return (
    <article
      className="ui-card report-card"
      data-testid="risk-card"
      data-side={card.attrs.side}
      data-entry={card.attrs.entry}
      data-mark={card.attrs.mark}
      data-liq={card.attrs.liq}
      data-distance={card.attrs.distance}
      data-deposit={card.attrs.deposit}
      data-free={card.attrs.free}
    >
      <div className="ui-card-head">
        <h3>{card.title}</h3>
      </div>
      <DistanceGauge distancePct={card.distancePct} actBelowPct={ACT_BELOW_PCT} safetyPct={SAFETY_PCT} />
      <dl className="report-facts">
        <div>
          <dt>Entry</dt>
          <dd>{card.entry}</dd>
        </div>
        <div>
          <dt>Mark</dt>
          <dd>{card.mark}</dd>
        </div>
        <div>
          <dt>Liquidation</dt>
          <dd>{card.liquidation}</dd>
        </div>
        <div>
          <dt>Margin</dt>
          <dd>{card.margin}</dd>
        </div>
        <div>
          <dt>Idle AUSD</dt>
          <dd>{card.idle}</dd>
        </div>
      </dl>
      <p>{card.forfeit}</p>
      <p data-testid="dry-run">{card.dryRun}</p>
      {action ? (
        <Button href={action.href} variant={primary ? "primary" : "secondary"} prefetch={false}>
          {action.label}
        </Button>
      ) : null}
    </article>
  );
}
