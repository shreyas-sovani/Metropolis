"use client";

import { acceptOwnershipTx, armDefaults, buildMandate, testNowTerms, withdrawCollateralTx } from "@lifeline/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress } from "viem";
import { userMessage } from "../../../lib/messages";
import {
  distancePctLabel,
  insideLineCopy,
  linesFromSafety,
  oneDecimal,
  outsideLineCopy,
  safetyCopy,
  type ProtectPhase,
} from "../../../lib/protection";
import { budgetFromFree, expiryInSevenDays, formatAusdWhole, leverageLabel, sandboxProxy, type ArmBody, type ClaimBody, type ClaimPosition } from "../../../lib/try-flow";
import type { TryClient, TrySession } from "../lifeline/e2e-client";

const SESSION_KEY = "lifeline.practice";
const CAP = 150_000_000n;

export interface PracticePosition extends ClaimPosition {
  freeCNS?: string;
  liquidation?: string;
}

export function useProtection(client: TryClient) {
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<ProtectPhase>("idle");
  const [session, setSession] = useState<TrySession | null>(null);
  const [claim, setClaim] = useState<ClaimBody | null>(null);
  const [live, setLive] = useState<PracticePosition | null>(null);
  const [safety, setSafety] = useState(6.5);
  const [receipt, setReceipt] = useState<ArmBody | null>(null);
  const [acceptTx, setAcceptTx] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [demoProxy, setDemoProxy] = useState("");
  const [started, setStarted] = useState(0);
  const turnstileRef = useRef("");
  const clientRef = useRef(client);
  clientRef.current = client;

  const remember = useCallback((next: TrySession) => {
    setSession(next);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  }, []);

  const readLive = useCallback(async (proxy: string, fallback: ClaimPosition): Promise<PracticePosition> => {
    const response = await fetch(`/api/account/${proxy}?chain=10143`);
    if (!response.ok) return fallback;
    const body = (await response.json()) as {
      positions?: { distanceE6: string; freeCNS: string; symbol: string; side: string; liquidationMicro?: string; priceDecimals?: number }[];
    };
    const row = body.positions?.[0];
    if (!row) return fallback;
    return {
      market: row.symbol || fallback.market,
      side: row.side || fallback.side,
      leverage: fallback.leverage,
      distanceE6: row.distanceE6,
      freeCNS: row.freeCNS,
      liquidation: row.liquidationMicro,
    };
  }, []);

  const applyClaim = useCallback(async (body: ClaimBody, nextSession: TrySession) => {
    if (!body.proxy || !body.position) return;
    remember(nextSession);
    setClaim(body);
    const position = await readLive(body.proxy, body.position);
    setLive(position);
    const terms = armDefaults(BigInt(position.distanceE6));
    setSafety(terms.targetBps / 100);
    const me = await clientRef.current.me(nextSession);
    const owner = me.claim?.ownerOnchain?.toLowerCase();
    if (me.mandate?.active) setPhase("protected");
    else if (owner && owner === nextSession.address.toLowerCase()) setPhase("choosing");
    else setPhase("owning");
  }, [readLive, remember]);

  useEffect(() => {
    setReady(true);
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    let saved: TrySession;
    try {
      saved = JSON.parse(raw) as TrySession;
    } catch {
      return;
    }
    if (!saved.userId || !saved.address) return;
    setSession(saved);
    void clientRef.current.me(saved).then(async (me) => {
      if (!me.claim?.proxy) return;
      await applyClaim(
        { proxy: me.claim.proxy, position: { market: "BTC", side: "long", leverage: "1500", distanceE6: "32000" } },
        saved,
      );
    });
  }, [applyClaim]);

  async function token() {
    const startedAt = Date.now();
    while (!turnstileRef.current && Date.now() - startedAt < 8_000) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return turnstileRef.current;
  }

  async function enterDemo() {
    setPhase("demo");
    const response = await fetch("/api/lifeline/sandbox-accounts");
    if (!response.ok) {
      setError("Demo mode has no shared account right now.");
      return;
    }
    const body = (await response.json()) as { accounts?: { proxy?: string; distanceE6?: string | null }[] };
    const proxy = sandboxProxy(body.accounts ?? []);
    if (!proxy) {
      setError("Demo mode has no shared account right now.");
      return;
    }
    setDemoProxy(proxy);
    const distance = body.accounts?.find((account) => account.proxy === proxy)?.distanceE6 ?? "27000";
    setLive({ market: "BTC", side: "long", leverage: "1500", distanceE6: distance, freeCNS: "300000000" });
    setSafety(armDefaults(BigInt(distance)).targetBps / 100);
  }

  async function openPractice() {
    setError("");
    setNotice("");
    setStarted(Date.now());
    if (process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).get("fault") === "pool") {
      const response = await fetch("/api/lifeline/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = (await response.json()) as ClaimBody;
      if (response.status === 503 || body.sandbox) {
        await enterDemo();
        return;
      }
    }
    setPhase("preparing");
    const prepared = await client.prepare();
    if (!prepared.ok) {
      await enterDemo();
      return;
    }
    setPhase("claiming");
    const turnstileToken = await token();
    const claimed = await client.claim(prepared.session, turnstileToken);
    if (claimed.status === 503 || claimed.body.sandbox) {
      await enterDemo();
      return;
    }
    if (claimed.status === 429) {
      setError(userMessage("rate").sentence);
      setPhase("error");
      return;
    }
    if (!claimed.body.proxy || !claimed.body.position) {
      setError(userMessage(claimed.body.error ?? "claim").sentence);
      setPhase("error");
      return;
    }
    setNotice(claimed.body.error === "claimed" ? userMessage("claimed").sentence : "");
    await applyClaim(claimed.body, prepared.session);
  }

  async function takeOwnership() {
    if (!session || !claim?.proxy) return;
    setError("");
    const built = acceptOwnershipTx(getAddress(claim.proxy));
    try {
      const sent = await client.send(session, built.to, built.data, built.gas.toString());
      setAcceptTx(sent.hash);
      await client.accepted(session, sent.hash);
      setPhase("choosing");
    } catch {
      setError(userMessage("ownership").sentence);
    }
  }

  async function sign(testNow = false) {
    if (!session || !claim?.proxy || !claim.perpId || !live) return;
    setPhase("signing");
    setError("");
    const distance = BigInt(live.distanceE6);
    const terms = testNow ? testNowTerms(distance) : linesFromSafety(safety);
    const message = buildMandate({
      account: getAddress(claim.proxy),
      perpIds: [BigInt(claim.perpId)],
      triggerBps: terms.triggerBps,
      targetBps: terms.targetBps,
      maxPerActionCNS: CAP,
      budgetCNS: budgetFromFree(BigInt(live.freeCNS ?? "0")),
      expiry: expiryInSevenDays(Math.floor(Date.now() / 1000)),
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
    if (!armed.body.txHash && !armed.body.skipped) {
      setError(userMessage(armed.body.error ?? armed.body.reason ?? "reverted").sentence);
      setPhase("choosing");
      return;
    }
    setReceipt(armed.body);
    setPhase("protected");
  }

  async function signDemo() {
    if (!demoProxy) return;
    setError("");
    const response = await fetch("/api/lifeline/sandbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proxy: demoProxy,
        triggerBps: linesFromSafety(safety).triggerBps,
        targetBps: linesFromSafety(safety).targetBps,
        turnstileToken: turnstileRef.current,
      }),
    });
    const body = (await response.json()) as ArmBody;
    if (!response.ok || !body.txHash) {
      setError(userMessage(body.error ?? "reverted").sentence);
      return;
    }
    setReceipt(body);
    setPhase("protected");
  }

  async function withdraw() {
    if (!session || !claim?.proxy) return;
    const built = withdrawCollateralTx(getAddress(claim.proxy), 50_000_000n);
    const sent = await client.send(session, built.to, built.data, built.gas.toString());
    setNotice(`Withdrew 50 AUSD. ${sent.hash}`);
  }

  async function disarm() {
    if (!session || !claim?.proxy) return;
    const result = await client.disarm(session, claim.proxy, `${Date.now()}`);
    if (result.status !== 200 && result.body.active !== false) {
      setError(userMessage(result.body.error ?? "disarm").sentence);
      return;
    }
    setNotice("Disarmed. Lifeline will not top this position up.");
  }

  const lines = linesFromSafety(safety);
  const distance = live ? distancePctLabel(live.distanceE6) : "";
  const copy = live
    ? [
        safetyCopy(distance, oneDecimal(lines.targetBps), oneDecimal(lines.triggerBps)),
        Number(live.distanceE6) / 100 < lines.triggerBps ? insideLineCopy() : outsideLineCopy(),
      ].join(" ")
    : "";

  return {
    ready,
    phase,
    claim,
    live,
    safety,
    setSafety,
    lines,
    copy,
    receipt,
    acceptTx,
    error,
    notice,
    started,
    elapsed: started && receipt ? Date.now() - started : 0,
    setToken: (value: string) => {
      turnstileRef.current = value;
    },
    openPractice,
    takeOwnership,
    sign,
    signDemo,
    withdraw,
    disarm,
    positionLine: live
      ? `${live.market} ${live.side} · ${leverageLabel(live.leverage)} · ${distance} from liquidation${live.freeCNS ? ` · ${formatAusdWhole(live.freeCNS)} idle` : ""}`
      : "",
  };
}
