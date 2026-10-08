"use client";

import { CALIBRATED, acceptOwnershipTx, armDefaults, buildMandate, testNowTerms, withdrawCollateralTx } from "@lifeline/core";
import { useEffect, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import { ExactBadge } from "../../exact-badge";
import { REVOKED_LABELS, TRADEOFF, WITHDRAW_AUSD, WITHDRAW_NOTE } from "../../../lib/copy";
import { userMessage } from "../../../lib/messages";
import { formatBlock, formatDistanceOne, formatUsd } from "../../../lib/format";
import {
  armSentence,
  budgetFromFree,
  expiryInSevenDays,
  formatAusdWhole,
  positionCard,
  sandboxProxy,
  useSandbox,
  type ArmBody,
  type ClaimBody,
  type ClaimPosition,
} from "../../../lib/try-flow";
import { addressUrl, txUrl } from "../../../lib/twins-view";
import type { TryClient, TrySession } from "./e2e-client";
import { TurnstileBox } from "./turnstile-box";

const CAP = 150_000_000n;

type Phase = "idle" | "working" | "accept" | "arm" | "receipt" | "sandbox";

interface LivePosition extends ClaimPosition {
  freeCNS?: string;
}

export function TryPanel({ client }: { client: TryClient }) {
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<TrySession | null>(null);
  const [claim, setClaim] = useState<ClaimBody | null>(null);
  const [live, setLive] = useState<LivePosition | null>(null);
  const [trigger, setTrigger] = useState(400);
  const [target, setTarget] = useState(600);
  const [sentence, setSentence] = useState("");
  const [receipt, setReceipt] = useState<ArmBody | null>(null);
  const [armedTarget, setArmedTarget] = useState(600);
  const [acceptTx, setAcceptTx] = useState<{ hash: string; nonce: number } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [sandboxAccount, setSandboxAccount] = useState("");
  const [started, setStarted] = useState(0);
  const turnstileRef = useRef("");

  useEffect(() => setReady(true), []);

  async function readLive(proxy: string, fallback: ClaimPosition) {
    const response = await fetch(`/api/account/${proxy}?chain=10143`);
    if (!response.ok) return fallback;
    const body = (await response.json()) as { positions?: { distanceE6: string; freeCNS: string; symbol: string; side: string }[] };
    const row = body.positions?.[0];
    if (!row) return fallback;
    return {
      market: row.symbol || fallback.market,
      side: row.side || fallback.side,
      leverage: fallback.leverage,
      distanceE6: row.distanceE6,
      freeCNS: row.freeCNS,
    };
  }

  function applyDistance(distanceE6: string, testNow = false) {
    const terms = testNow ? testNowTerms(BigInt(distanceE6)) : armDefaults(BigInt(distanceE6));
    setTrigger(terms.triggerBps);
    setTarget(terms.targetBps);
    setSentence(armSentence(BigInt(distanceE6), terms));
  }

  async function openSandbox() {
    setPhase("sandbox");
    setError("");
    const response = await fetch("/api/lifeline/sandbox-accounts");
    if (!response.ok) {
      setError(userMessage("empty").sentence);
      return;
    }
    const body = (await response.json()) as { accounts?: { proxy: string; distanceE6?: string | null }[] };
    const proxy = sandboxProxy(body.accounts ?? []);
    if (!proxy) {
      setError(userMessage("empty").sentence);
      return;
    }
    setSandboxAccount(proxy);
    const distance = body.accounts?.find((account) => account.proxy === proxy)?.distanceE6 ?? "27000";
    applyDistance(distance);
  }

  async function start() {
    setError("");
    setNote("");
    setStarted(Date.now());
    setPhase("working");
    if (process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).get("fault") === "pool") {
      const response = await fetch("/api/lifeline/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = (await response.json()) as ClaimBody;
      if (useSandbox({ privyFailed: false, status: response.status, sandbox: body.sandbox })) {
        await openSandbox();
        return;
      }
    }
    const prepared = await client.prepare();
    if (!prepared.ok) {
      await openSandbox();
      return;
    }
    setSession(prepared.session);
    const turnstileToken = await waitForTurnstile(turnstileRef);
    const claimed = await client.claim(prepared.session, turnstileToken);
    if (useSandbox({ privyFailed: false, status: claimed.status, sandbox: claimed.body.sandbox })) {
      await openSandbox();
      return;
    }
    if (!claimed.body.proxy || !claimed.body.perpId || !claimed.body.position) {
      const reason = claimed.body.error ? claimed.body.error.slice(0, 140) : "The claim did not return a position.";
      setError(claimed.body.error === "claimed" ? userMessage("claimed").sentence : userMessage(reason).sentence);
      setPhase("idle");
      return;
    }
    setClaim(claimed.body);
    const position = await readLive(claimed.body.proxy, claimed.body.position);
    setLive(position);
    applyDistance(position.distanceE6);
    setPhase("accept");
  }

  async function accept() {
    if (!session || !claim?.proxy) return;
    setError("");
    const proxy = getAddress(claim.proxy);
    const built = acceptOwnershipTx(proxy);
    try {
      const sent = await client.send(session, built.to, built.data, built.gas.toString());
      setAcceptTx(sent);
      const position = await readLive(proxy, live ?? claim.position ?? { market: "BTC", side: "long", leverage: "1500", distanceE6: "27000" });
      setLive(position);
      applyDistance(position.distanceE6);
      setPhase("arm");
    } catch {
      setError(userMessage("ownership").sentence);
    }
  }

  async function arm(testNow = false) {
    if (!session || !claim?.proxy || !claim.perpId || !live) return;
    setError("");
    const distance = BigInt(live.distanceE6);
    const terms = testNow ? testNowTerms(distance) : { triggerBps: trigger, targetBps: target };
    if (testNow) applyDistance(live.distanceE6, true);
    const free = BigInt(live.freeCNS ?? "0");
    const message = buildMandate({
      account: getAddress(claim.proxy),
      perpIds: [BigInt(claim.perpId)],
      triggerBps: terms.triggerBps,
      targetBps: terms.targetBps,
      maxPerActionCNS: CAP,
      budgetCNS: budgetFromFree(free),
      expiry: expiryInSevenDays(Math.floor(Date.now() / 1000)),
      nonce: BigInt(Date.now()),
    });
    setArmedTarget(terms.targetBps);
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
    if (!armed.body.txHash) {
      setError(
        armed.body.skipped
          ? userMessage(armed.body.reason ?? "skip").sentence
          : userMessage(armed.body.error ?? "reverted").sentence,
      );
      if (armed.body.skipped) setReceipt(armed.body);
      return;
    }
    setReceipt(armed.body);
    setPhase("receipt");
  }

  async function armSandbox() {
    if (!sandboxAccount) return;
    setError("");
    const response = await fetch("/api/lifeline/sandbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proxy: sandboxAccount,
        triggerBps: trigger,
        targetBps: target,
        turnstileToken: await waitForTurnstile(turnstileRef),
      }),
    });
    const body = (await response.json()) as ArmBody;
    if (!response.ok || !body.txHash) {
      setError(userMessage(body.error ?? "reverted").sentence);
      return;
    }
    setReceipt(body);
    setPhase("receipt");
  }

  async function withdraw() {
    if (!session || !claim?.proxy) return;
    setError("");
    const built = withdrawCollateralTx(getAddress(claim.proxy), WITHDRAW_AUSD);
    try {
      const sent = await client.send(session, built.to, built.data, built.gas.toString());
      setNote(`Withdrew 50 AUSD. ${sent.hash}`);
    } catch {
      setError(userMessage("withdraw").sentence);
    }
  }

  async function disarm() {
    if (!session || !claim?.proxy) return;
    setError("");
    const result = await client.disarm(session, claim.proxy, `${Date.now()}`);
    if (!result.body.active && result.status !== 200) {
      setError(userMessage(result.body.error ?? "pause").sentence);
      return;
    }
    setNote("Paused. Lifeline won't add margin until you resume.");
  }

  const card = live ?? claim?.position;
  const elapsed = started && receipt ? Date.now() - started : 0;
  const proxy = claim?.proxy ? getAddress(claim.proxy as Address) : "";

  return (
    <div className="flow">
      <TurnstileBox onToken={(token) => {
        turnstileRef.current = token;
      }} />
      {phase === "idle" || phase === "working" ? (
        <button type="button" data-ready={ready ? "yes" : "no"} onClick={() => void start()} disabled={phase === "working"}>
          {phase === "working" ? "Claiming a testnet position" : "Try Lifeline live"}
        </button>
      ) : null}
      {phase === "sandbox" ? (
        <section className="panel" data-testid="sandbox">
          <h2>Demo mode</h2>
          <p>You're using a shared house account, so you can see protection work without a wallet. Nothing here belongs to you.</p>
          <ArmFields trigger={trigger} target={target} sentence={sentence} onTrigger={setTrigger} onTarget={setTarget} />
          <button type="button" onClick={() => void armSandbox()}>
            Sign and turn on protection
          </button>
        </section>
      ) : null}
      {card && (phase === "accept" || phase === "arm" || phase === "receipt") ? (
        <p className="card-line" data-testid="position-card">
          {positionCard(card)}
        </p>
      ) : null}
      {phase === "accept" && claim?.proxy ? (
        <section className="panel">
          <h2>Take ownership</h2>
          <p>One transaction. After this, only you can withdraw.</p>
          <button type="button" onClick={() => void accept()}>
            Take ownership
          </button>
        </section>
      ) : null}
      {phase === "arm" ? (
        <section className="panel">
          <h2>Safety line</h2>
          {acceptTx ? (
            <p>
              <a href={txUrl(acceptTx.hash)}>Ownership transaction</a>
            </p>
          ) : null}
          <ArmFields trigger={trigger} target={target} sentence={sentence} onTrigger={setTrigger} onTarget={setTarget} />
          <p>Per top-up limit 150 AUSD. Budget {live?.freeCNS ? formatAusdWhole((BigInt(live.freeCNS) / 2n).toString()) : "half of your idle AUSD"}. This position. Lasts 7 days.</p>
          <div className="row">
            <button type="button" onClick={() => void arm(false)}>
              Sign and turn on protection
            </button>
            <button type="button" onClick={() => void arm(true)}>
              Test Lifeline now
            </button>
          </div>
        </section>
      ) : null}
      {phase === "receipt" && receipt ? (
        <section
          className="panel receipt"
          data-testid="receipt"
          data-proxy={proxy}
          data-perp={claim?.perpId ?? ""}
          data-target={armedTarget}
          data-dist={receipt.distAfter ?? ""}
          data-owner-txs={acceptTx ? "1" : "0"}
          data-elapsed-ms={elapsed}
          aria-live="polite"
        >
          <h2>Receipt</h2>
          <ExactBadge calibrated={CALIBRATED} />
          <Marker beforeE6={receipt.distBefore ?? "0"} afterE6={receipt.distAfter ?? receipt.distBefore ?? "0"} />
          <p>
            Distance {receipt.distBefore ? formatDistanceOne(receipt.distBefore) : "unknown"} → {receipt.distAfter ? formatDistanceOne(receipt.distAfter) : "unknown"}.
            {receipt.block ? ` Confirmed in ${formatBlock(receipt.block)}.` : ""}
          </p>
          <p>
            Liquidation {receipt.liqBefore ? formatUsd(receipt.liqBefore) : "unknown"} → {receipt.liqAfter ? formatUsd(receipt.liqAfter) : "unknown"}. Added {receipt.addedCNS ? formatAusdWhole(receipt.addedCNS) : "0 AUSD"}.
          </p>
          {receipt.txHash ? (
            <p>
              <a href={txUrl(receipt.txHash)}>Top-up on the explorer</a>
            </p>
          ) : null}
          {claim?.proxy ? (
            <>
              <p className="warn">{WITHDRAW_NOTE}</p>
              <p>
                What Lifeline can&apos;t do: {REVOKED_LABELS.join(", ")}.{" "}
                <a href={addressUrl(proxy)}>Checked on chain</a>
              </p>
              <div className="row">
                <button type="button" onClick={() => void withdraw()}>
                  Withdraw 50 AUSD
                </button>
                <button type="button" onClick={() => void disarm()}>
                  Pause protection
                </button>
                <button type="button" onClick={() => void client.keep().then(() => setNote("This account stays with you."))}>
                  Keep this account
                </button>
              </div>
            </>
          ) : null}
        </section>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {note ? <p data-testid="flow-note">{note}</p> : null}
      {phase === "accept" || phase === "arm" ? (
        <p>
          <a href="/radar?chain=10143">This position is on the testnet market map</a> until you turn protection on.
        </p>
      ) : null}
    </div>
  );
}

function ArmFields({
  trigger,
  target,
  sentence,
  onTrigger,
  onTarget,
}: {
  trigger: number;
  target: number;
  sentence: string;
  onTrigger: (value: number) => void;
  onTarget: (value: number) => void;
}) {
  return (
    <div className="form-grid">
      <p data-testid="arm-sentence">{sentence}</p>
      <p className="warn">{TRADEOFF}</p>
      <label>
        Act-below line
        <input aria-label="Act-below line" value={trigger} onChange={(event) => onTrigger(Number(event.target.value))} />
      </label>
      <label>
        Safety line
        <input aria-label="Safety line" value={target} onChange={(event) => onTarget(Number(event.target.value))} />
      </label>
    </div>
  );
}

function Marker({ beforeE6, afterE6 }: { beforeE6: string; afterE6: string }) {
  const [left, setLeft] = useState(place(beforeE6));
  useEffect(() => {
    const id = requestAnimationFrame(() => setLeft(place(afterE6)));
    return () => cancelAnimationFrame(id);
  }, [afterE6]);
  return (
    <div className="marker-track" aria-hidden="true">
      <span className="marker" data-testid="marker" style={{ left }} />
    </div>
  );
}

async function waitForTurnstile(token: { current: string }): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    if (token.current) return token.current;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return token.current;
}

function place(distanceE6: string): string {
  const value = Math.max(2, Math.min(96, Number(distanceE6) / 1000));
  return `${Number.isFinite(value) ? value : 2}%`;
}
