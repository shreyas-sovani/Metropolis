"use client";

import { TESTNET_ID, buildMandate, withdrawCollateralTx } from "@lifeline/core";
import { useCallback, useEffect, useState } from "react";
import { getAddress } from "viem";
import { formatAusd } from "../../../lib/account";
import { readAppEvents, readSavedTerms, writeAppEvent } from "../../../lib/app-log";
import { activityRows, daysLeft, heartbeatLine, type ActivityAction, type ActivityClaim } from "../../../lib/activity";
import { addressUrl } from "../../../lib/explorer";
import { formatMon, formatPrice } from "../../../lib/format";
import { clampLines, expiryFromDays, oneDecimal } from "../../../lib/protection";
import { leverageLabel } from "../../../lib/try-flow";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { DistanceGauge } from "../../ui/distance-gauge";
import { Field } from "../../ui/field";
import { PercentSlider } from "../../ui/percent-slider";
import { Timeline } from "../../ui/timeline";
import { useOpsHealth } from "../../ui/ops-health";
import type { TryClient, TrySession } from "../lifeline/e2e-client";
import "./dashboard.css";

interface MandateView {
  active: boolean;
  kind: string;
  triggerBps: number;
  targetBps: number;
  budgetCNS: string;
  budgetUsedCNS: string;
  maxPerActionCNS: string;
  expiry: string;
}

interface AccountPosition {
  symbol: string;
  side: string;
  leverage?: string;
  distanceE6: string;
  markMicro?: string;
  liquidationMicro?: string;
  priceDecimals?: number;
  depositMicro?: string;
  freeCNS?: string;
}

interface MeBody {
  claim: (ActivityClaim & {
    proxy?: string;
    perpId?: string;
    market?: string;
    side?: string;
    leverage?: string;
  }) | null;
  mandate: MandateView | null;
}

const FIXTURE: MeBody = {
  claim: {
    proxy: "0xC0385344A3641F3ba8fb7c5AdFB47a5bEeb7702A",
    perpId: "16",
    market: "BTC",
    side: "long",
    leverage: "1500",
    claimedAt: Date.now() - 180_000,
    acceptedAt: Date.now() - 120_000,
    transferTx: `0x${"ab".repeat(32)}`,
    acceptTx: `0x${"cd".repeat(32)}`,
  },
  mandate: {
    active: true,
    kind: "user",
    triggerBps: 450,
    targetBps: 650,
    budgetCNS: "150000000",
    budgetUsedCNS: "61000000",
    maxPerActionCNS: "150000000",
    expiry: String(Math.floor(Date.now() / 1000) + 6 * 86_400),
  },
};

const FIXTURE_POSITION: AccountPosition = {
  symbol: "BTC",
  side: "long",
  leverage: "1500",
  distanceE6: "65000",
  markMicro: "83702300000",
  liquidationMicro: "78920000000",
  priceDecimals: 1,
  depositMicro: "161000000",
  freeCNS: "239000000",
};

const FIXTURE_ACTIONS: ActivityAction[] = [
  {
    txHash: `0x${"ef".repeat(32)}`,
    amountCNS: "61000000",
    distBefore: "32000",
    distAfter: "65000",
    createdAt: Date.now() - 90_000,
  },
];

function shotName(): "dashboard" | "withdraw" | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const shot = new URLSearchParams(window.location.search).get("shot");
  if (shot === "dashboard" || shot === "withdraw") return shot;
  return null;
}

export function Dashboard({ client, session }: { client: TryClient; session: TrySession }) {
  const shot = shotName();
  const health = useOpsHealth();
  const [now, setNow] = useState(() => Date.now());
  const [me, setMe] = useState<MeBody | null>(shot ? FIXTURE : null);
  const [position, setPosition] = useState<AccountPosition | null>(shot ? FIXTURE_POSITION : null);
  const [actions, setActions] = useState<ActivityAction[]>(shot ? FIXTURE_ACTIONS : []);
  const [notes, setNotes] = useState(shot ? [{ kind: "signed" as const, at: Date.now() - 100_000, targetBps: 650 }] : readAppEvents(session.userId));
  const [wallet, setWallet] = useState(shot ? { monWei: "70000000000000000", ausdMicro: "0" } : { monWei: "0", ausdMicro: "0" });
  const [adjusting, setAdjusting] = useState(false);
  const [safety, setSafety] = useState(6.5);
  const [withdrawAusd, setWithdrawAusd] = useState(shot === "withdraw" ? "50" : "");
  const [withdrawOpen, setWithdrawOpen] = useState(shot === "withdraw");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [savedEmail, setSavedEmail] = useState("");
  const [busy, setBusy] = useState("");

  const reloadMe = useCallback(async () => {
    if (shot) return;
    const body = (await client.me(session)) as MeBody;
    setMe(body);
    setNotes(readAppEvents(session.userId));
  }, [client, session, shot]);

  const reloadAccount = useCallback(async (proxy: string) => {
    if (shot) return;
    const response = await fetch(`/api/account/${proxy}?chain=10143`);
    if (!response.ok) return;
    const body = (await response.json()) as { idleMicro?: string; positions?: AccountPosition[] };
    const row = body.positions?.[0];
    if (!row) return;
    setPosition({ ...row, freeCNS: row.freeCNS || body.idleMicro });
  }, [shot]);

  const reloadActions = useCallback(async (proxy: string) => {
    if (shot) return;
    const response = await fetch(`/api/actions?account=${proxy}`);
    if (!response.ok) return;
    const body = (await response.json()) as { actions?: ActivityAction[] };
    setActions(body.actions ?? []);
  }, [shot]);

  const reloadWallet = useCallback(async () => {
    if (shot) return;
    const response = await fetch(`/api/wallet/${session.address}`);
    if (!response.ok) return;
    const body = (await response.json()) as { monWei?: string; ausdMicro?: string };
    setWallet({ monWei: body.monWei ?? "0", ausdMicro: body.ausdMicro ?? "0" });
  }, [session.address, shot]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (shot) return;
    void reloadMe();
    void reloadWallet();
  }, [reloadMe, reloadWallet, shot]);

  useEffect(() => {
    const proxy = me?.claim?.proxy;
    if (!proxy || shot) return;
    void reloadAccount(proxy);
    void reloadActions(proxy);
    const accountTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reloadAccount(proxy);
    }, 3_000);
    const actionTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reloadActions(proxy);
    }, 5_000);
    return () => {
      window.clearInterval(accountTimer);
      window.clearInterval(actionTimer);
    };
  }, [me?.claim?.proxy, reloadAccount, reloadActions, shot]);

  const mandate = me?.mandate;
  const claim = me?.claim;
  const paused = me !== null && !mandate?.active;
  const proxy = claim?.proxy ?? "";
  const idle = position?.freeCNS ?? "0";
  const rows = activityRows({ claim: claim ?? null, actions, notes });
  const market = `${position?.symbol || claim?.market || "BTC"} ${position?.side || claim?.side || "long"} · ${leverageLabel(position?.leverage || claim?.leverage || "1500")} · testnet`;

  async function saveLine() {
    if (!claim?.proxy || !claim.perpId || !mandate) return;
    setBusy("save");
    setError("");
    const lines = clampLines(safety, safety - 2);
    const message = buildMandate({
      account: getAddress(claim.proxy),
      perpIds: [BigInt(claim.perpId)],
      triggerBps: lines.triggerBps,
      targetBps: lines.targetBps,
      maxPerActionCNS: BigInt(mandate.maxPerActionCNS || "150000000"),
      budgetCNS: BigInt(mandate.budgetCNS || "1"),
      expiry: expiryFromDays("7", Math.floor(Date.now() / 1000)),
      nonce: BigInt(Date.now()),
    });
    const armed = await client.arm(session, {
      account: message.account,
      perpIds: message.perpIds.map((id) => id.toString()),
      triggerBps: message.triggerBps,
      targetBps: message.targetBps,
      maxPerActionCNS: message.maxPerActionCNS.toString(),
      budgetCNS: message.budgetCNS.toString(),
      expiry: message.expiry.toString(),
      nonce: message.nonce.toString(),
    });
    setBusy("");
    if (!armed.body.txHash && !armed.body.skipped && armed.status >= 400) {
      setError("The safety line wasn't saved. Try signing again.");
      return;
    }
    writeAppEvent(session.userId, { kind: "adjusted", at: Date.now(), targetBps: lines.targetBps, triggerBps: lines.triggerBps, budgetCNS: mandate.budgetCNS, maxPerActionCNS: mandate.maxPerActionCNS });
    setAdjusting(false);
    setNotice("Safety line updated.");
    await reloadMe();
  }

  async function pause() {
    if (!claim?.proxy || !mandate) return;
    setBusy("pause");
    writeAppEvent(session.userId, {
      kind: "paused",
      at: Date.now(),
      targetBps: mandate.targetBps,
      triggerBps: mandate.triggerBps,
      budgetCNS: mandate.budgetCNS,
      maxPerActionCNS: mandate.maxPerActionCNS,
    });
    const result = await client.disarm(session, claim.proxy, `${Date.now()}`);
    setBusy("");
    if (result.status !== 200 && result.body.active !== false) {
      setError("Protection is still on. Try pausing again.");
      return;
    }
    setNotice("Paused. Lifeline won't add margin until you resume.");
    await reloadMe();
  }

  async function resume() {
    if (!claim?.proxy || !claim.perpId) return;
    const saved = readSavedTerms(session.userId);
    if (!saved?.targetBps || !saved.triggerBps) {
      setError("Choose a safety line again to resume.");
      setAdjusting(true);
      return;
    }
    setBusy("resume");
    const message = buildMandate({
      account: getAddress(claim.proxy),
      perpIds: [BigInt(claim.perpId)],
      triggerBps: saved.triggerBps,
      targetBps: saved.targetBps,
      maxPerActionCNS: BigInt(saved.maxPerActionCNS || "150000000"),
      budgetCNS: BigInt(saved.budgetCNS || "1"),
      expiry: expiryFromDays("7", Math.floor(Date.now() / 1000)),
      nonce: BigInt(Date.now()),
    });
    const armed = await client.arm(session, {
      account: message.account,
      perpIds: message.perpIds.map((id) => id.toString()),
      triggerBps: message.triggerBps,
      targetBps: message.targetBps,
      maxPerActionCNS: message.maxPerActionCNS.toString(),
      budgetCNS: message.budgetCNS.toString(),
      expiry: message.expiry.toString(),
      nonce: message.nonce.toString(),
    });
    setBusy("");
    if (armed.status >= 400 && !armed.body.txHash && !armed.body.skipped) {
      setError("Protection didn't resume. Try again.");
      return;
    }
    writeAppEvent(session.userId, { kind: "resumed", at: Date.now(), targetBps: saved.targetBps, triggerBps: saved.triggerBps });
    setNotice("Protection is on again.");
    await reloadMe();
  }

  async function withdraw() {
    if (!claim?.proxy) return;
    const whole = Number(withdrawAusd);
    if (!Number.isFinite(whole) || whole <= 0) {
      setError("Enter an amount up to your idle AUSD.");
      return;
    }
    const amount = BigInt(Math.round(whole * 1_000_000));
    if (amount > BigInt(idle || "0")) {
      setError("You can withdraw up to your idle AUSD.");
      return;
    }
    setBusy("withdraw");
    setError("");
    const built = withdrawCollateralTx(getAddress(claim.proxy), amount);
    try {
      await client.send(session, built.to, built.data, built.gas.toString());
    } catch {
      setBusy("");
      setError("Withdrawal didn't go through. You can withdraw up to your idle AUSD.");
      return;
    }
    setBusy("");
    setNotice(`Withdrew ${whole} AUSD.`);
    await reloadWallet();
    if (claim.proxy) await reloadAccount(claim.proxy);
  }

  async function keep() {
    setError("");
    try {
      await client.keep();
      setSavedEmail("your email");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      if (/link existing/i.test(message)) {
        setError("That email already has a Privy account. Use a different email, or keep using this browser.");
        return;
      }
      setError("The email wasn't saved. You can keep using this browser.");
    }
  }

  const heartbeat = heartbeatLine(health.lastAlarmAt, health.lastBlock, now);

  return (
    <div className="ui-scope">
      <main className="container dash-page" data-testid="dashboard" data-account={proxy}>
        <header className="dash-head">
          <h1>Your protection</h1>
          <Badge tone={paused ? "clay" : "olive"}>{paused ? "Paused" : "Armed"}</Badge>
        </header>
        <div className="dash-grid">
          <Card>
            <div className="dash-card">
              <h2>Position health</h2>
              <p className="dash-meta">{market}</p>
              <DistanceGauge
                distancePct={position ? Number(position.distanceE6) / 10_000 : 0}
                actBelowPct={(mandate?.triggerBps ?? 450) / 100}
                safetyPct={(mandate?.targetBps ?? 650) / 100}
              />
              <p>
                Mark {position?.markMicro ? formatPrice(position.markMicro, position.priceDecimals ?? 1) : "—"} · Liquidation{" "}
                {position?.liquidationMicro ? formatPrice(position.liquidationMicro, position.priceDecimals ?? 1) : "—"}
              </p>
              <p>
                Margin {position?.depositMicro ? `${formatAusd(position.depositMicro)} AUSD` : "—"} · Idle {formatAusd(idle)} AUSD
              </p>
            </div>
          </Card>
          <Card>
            <div className="dash-card">
              <h2>Lifeline</h2>
              <p data-testid="heartbeat">{heartbeat}</p>
              {paused ? (
                <p>Paused. Lifeline won't add margin until you resume.</p>
              ) : (
                <p>
                  Safety line {mandate ? oneDecimal(mandate.targetBps) : "—"} · steps in below {mandate ? oneDecimal(mandate.triggerBps) : "—"}
                </p>
              )}
              {mandate ? (
                <p>
                  Budget {formatAusd(mandate.budgetUsedCNS)} of {formatAusd(mandate.budgetCNS)} AUSD used · {daysLeft(mandate.expiry, Math.floor(now / 1000))}
                </p>
              ) : null}
              <div className="dash-actions">
                <Button variant="secondary" onClick={() => setAdjusting((open) => !open)}>
                  Adjust safety line
                </Button>
                {paused ? (
                  <Button variant="primary" onClick={() => void resume()} busy={busy === "resume"} busyLabel="Resuming">
                    Resume protection
                  </Button>
                ) : (
                  <Button variant="quiet" onClick={() => void pause()} busy={busy === "pause"} busyLabel="Pausing">
                    Pause protection
                  </Button>
                )}
              </div>
              {adjusting ? (
                <div>
                  <PercentSlider
                    id="dash-safety"
                    label="Keep my position at least this far from liquidation"
                    value={safety}
                    min={1}
                    max={20}
                    step={0.5}
                    onChange={setSafety}
                  />
                  <Button variant="primary" onClick={() => void saveLine()} busy={busy === "save"} busyLabel="Signing">
                    Save safety line
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>
        </div>
        <Card>
          <div className="dash-card">
            <h2>Activity</h2>
            {rows.length === 0 ? <p>Nothing has happened on this account yet.</p> : <Timeline rows={rows.map((row) => ({ ...row, chainId: TESTNET_ID, linkLabel: "View" }))} />}
          </div>
        </Card>
        <div className="dash-split">
          <Card>
            <div className="dash-card">
              <h2>Your money</h2>
              <p>
                Wallet {session.address.slice(0, 6)}…{session.address.slice(-4)} · {formatMon(wallet.monWei)} · {formatAusd(wallet.ausdMicro)} AUSD
              </p>
              {withdrawOpen ? (
                <div className="dash-money">
                  <Field label="Withdraw idle AUSD" htmlFor="withdraw-ausd">
                    <input id="withdraw-ausd" className="ui-input" inputMode="decimal" value={withdrawAusd} onChange={(event) => setWithdrawAusd(event.target.value)} />
                  </Field>
                  <Button
                    variant="quiet"
                    onClick={() => setWithdrawAusd((Number(idle) / 1_000_000).toString())}
                  >
                    Max
                  </Button>
                  <Button variant="primary" onClick={() => void withdraw()} busy={busy === "withdraw"} busyLabel="Withdrawing">
                    Withdraw
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setWithdrawOpen(true)}>
                  Withdraw idle AUSD
                </Button>
              )}
              <p>Only you can do this.</p>
            </div>
          </Card>
          <Card>
            <div className="dash-card">
              <h2>What Lifeline can and can't do</h2>
              <p>Can: add idle AUSD to margin within your budget.</p>
              <p>Can't: trade, close, withdraw, or move funds out.</p>
              {proxy ? (
                <p>
                  Checked on chain →{" "}
                  <a href={addressUrl(TESTNET_ID, proxy)}>this account on the explorer</a>
                </p>
              ) : null}
            </div>
          </Card>
        </div>
        <div className="dash-keep">
          <p>Keep this account. Your wallet lives in this browser. Add an email to keep it.</p>
          {savedEmail ? <p>Saved to {savedEmail}</p> : <Button variant="secondary" onClick={() => void keep()}>Save with email</Button>}
        </div>
        {proxy ? (
          <p className="dash-map">
            <a href={`/radar?chain=10143&highlight=${proxy}`}>See it on the testnet market map</a>
          </p>
        ) : null}
        {notice ? <p data-testid="flow-note">{notice}</p> : null}
        {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
      </main>
    </div>
  );
}
