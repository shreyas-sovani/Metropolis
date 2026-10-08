"use client";

import { acceptOwnershipTx, armDefaults, buildMandate, testNowTerms, withdrawCollateralTx } from "@lifeline/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress } from "viem";
import { userMessage } from "../../../lib/messages";
import {
  ausdToMicro,
  clampLines,
  distancePctLabel,
  expiryFromDays,
  insideLineCopy,
  oneDecimal,
  outsideLineCopy,
  previewTopUp,
  safetyCopy,
  type PreviewPosition,
  type ProtectPhase,
} from "../../../lib/protection";
import { formatPrice } from "../../../lib/format";
import {
  budgetFromFree,
  formatAusdWhole,
  leverageLabel,
  sandboxProxy,
  type ArmBody,
  type ClaimBody,
  type ClaimPosition,
} from "../../../lib/try-flow";
import type { TryClient, TrySession } from "../lifeline/e2e-client";

const SESSION_KEY = "lifeline.practice";
const CAP = 150_000_000n;

export interface PracticePosition extends ClaimPosition, PreviewPosition {
  freeCNS?: string;
  liquidation?: string;
  priceDecimals?: number;
}

interface ShotState {
  phase: ProtectPhase;
  receipt: ArmBody | null;
  acceptTx: string;
}

function shotState(): ShotState | null {
  if (process.env.NODE_ENV === "production") return null;
  const shot = new URLSearchParams(window.location.search).get("shot");
  if (shot === "owning") return { phase: "owning", receipt: null, acceptTx: "" };
  if (shot === "choosing") return { phase: "choosing", receipt: null, acceptTx: "" };
  if (shot === "receipt") {
    return {
      phase: "protected",
      acceptTx: `0x${"ab".repeat(32)}`,
      receipt: {
        txHash: `0x${"cd".repeat(32)}`,
        block: 68909760,
        addedCNS: "61000000",
        liqBefore: "81040000000",
        liqAfter: "78920000000",
        distBefore: "32000",
        distAfter: "65000",
      },
    };
  }
  return null;
}

function faultName(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  return new URLSearchParams(window.location.search).get("fault");
}

export function useProtection(client: TryClient) {
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<ProtectPhase>("idle");
  const [session, setSession] = useState<TrySession | null>(null);
  const [claim, setClaim] = useState<ClaimBody | null>(null);
  const [live, setLive] = useState<PracticePosition | null>(null);
  const [safety, setSafety] = useState(6.5);
  const [actBelow, setActBelow] = useState(4.5);
  const [budgetInput, setBudgetInput] = useState("150");
  const [capInput, setCapInput] = useState("150");
  const [daysInput, setDaysInput] = useState("7");
  const [receipt, setReceipt] = useState<ArmBody | null>(null);
  const [acceptTx, setAcceptTx] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [offerDemo, setOfferDemo] = useState(false);
  const [needsHuman, setNeedsHuman] = useState(false);
  const [demoProxy, setDemoProxy] = useState("");
  const [started, setStarted] = useState(0);
  const turnstileRef = useRef("");
  const resetRef = useRef<(() => void) | null>(null);
  const pendingRetry = useRef(false);
  const retried = useRef(false);
  const actTouched = useRef(false);
  const safetyRef = useRef(safety);
  const actRef = useRef(actBelow);
  const clientRef = useRef(client);
  safetyRef.current = safety;
  actRef.current = actBelow;
  clientRef.current = client;

  const remember = useCallback((next: TrySession) => {
    setSession(next);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  }, []);

  const readLive = useCallback(async (proxy: string, fallback: ClaimPosition): Promise<PracticePosition> => {
    const response = await fetch(`/api/account/${proxy}?chain=10143`);
    if (!response.ok) return fallback;
    const body = (await response.json()) as {
      positions?: {
        distanceE6: string;
        freeCNS: string;
        symbol: string;
        side: string;
        liquidationMicro?: string;
        priceDecimals?: number;
        entryMicro?: string;
        markMicro?: string;
        lot?: string;
        fundingMicro?: string;
        mmf?: string;
        depositMicro?: string;
        leverage?: string;
      }[];
    };
    const row = body.positions?.[0];
    if (!row) return fallback;
    return {
      market: row.symbol || fallback.market,
      side: row.side || fallback.side,
      leverage: row.leverage || fallback.leverage,
      distanceE6: row.distanceE6,
      freeCNS: row.freeCNS,
      liquidation: row.liquidationMicro,
      priceDecimals: row.priceDecimals,
      entryMicro: row.entryMicro,
      markMicro: row.markMicro,
      lot: row.lot,
      fundingMicro: row.fundingMicro,
      mmf: row.mmf,
      depositMicro: row.depositMicro,
    };
  }, []);

  const applyClaim = useCallback(
    async (body: ClaimBody, nextSession: TrySession) => {
      if (!body.proxy || !body.position) return;
      remember(nextSession);
      setClaim(body);
      const position = await readLive(body.proxy, body.position);
      setLive(position);
      const terms = armDefaults(BigInt(position.distanceE6));
      const lines = clampLines(terms.targetBps / 100, terms.triggerBps / 100);
      setSafety(lines.safetyPct);
      setActBelow(lines.actBelowPct);
      actTouched.current = false;
      const idle = BigInt(position.freeCNS ?? "0");
      setBudgetInput((budgetFromFree(idle) / 1_000_000n).toString());
      setCapInput("150");
      setDaysInput("7");
      if (nextSession.userId === "fault") {
        setPhase("owning");
        return;
      }
      let owner = "";
      let userMandate = false;
      try {
        const me = await clientRef.current.me(nextSession);
        owner = me.claim?.ownerOnchain?.toLowerCase() ?? "";
        userMandate = me.mandate?.kind === "user";
      } catch {
        owner = "";
      }
      if (userMandate) setPhase("protected");
      else if (owner && owner === nextSession.address.toLowerCase()) setPhase("choosing");
      else setPhase("owning");
    },
    [readLive, remember],
  );

  useEffect(() => {
    const shot = shotState();
    if (shot) {
      const position: PracticePosition = {
        market: "BTC",
        side: "long",
        leverage: "1500",
        distanceE6: "32000",
        freeCNS: "300000000",
        liquidation: "81040000000",
        priceDecimals: 1,
        entryMicro: "83700000000",
        markMicro: "83702300000",
        lot: "100000000000000000",
        fundingMicro: "0",
        mmf: "25",
        depositMicro: "200000000",
      };
      setSession({ userId: "shot", address: "0x68927BE500A643BBDc3bAAac1372fDDD2ffa23d4" });
      setClaim({ proxy: "0xC0385344A3641F3ba8fb7c5AdFB47a5bEeb7702A", perpId: "16", position });
      setLive(position);
      setSafety(6.5);
      setActBelow(4.5);
      setBudgetInput("150");
      setPhase(shot.phase);
      setReceipt(shot.receipt);
      setAcceptTx(shot.acceptTx);
      setStarted(shot.receipt ? Date.now() - 1_200 : 0);
      setReady(true);
      return;
    }
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
    void clientRef.current
      .me(saved)
      .then(async (me) => {
        if (!me.claim?.proxy) return;
        await applyClaim(
          {
            proxy: me.claim.proxy,
            perpId: me.claim.perpId,
            position: {
              market: me.claim.market || "BTC",
              side: me.claim.side || "long",
              leverage: me.claim.leverage || "1500",
              distanceE6: "32000",
            },
          },
          saved,
        );
      })
      .catch(() => undefined);
  }, [applyClaim]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!turnstileRef.current) setNeedsHuman(true);
    }, 4_000);
    return () => window.clearTimeout(timer);
  }, []);

  async function token() {
    if (process.env.NEXT_PUBLIC_E2E_WALLET === "test") return turnstileRef.current || "e2e";
    const startedAt = Date.now();
    while (!turnstileRef.current && Date.now() - startedAt < 4_000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return turnstileRef.current;
  }

  function consumeToken() {
    turnstileRef.current = "";
    resetRef.current?.();
  }

  async function enterDemo() {
    setOfferDemo(false);
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
    const terms = armDefaults(BigInt(distance));
    const lines = clampLines(terms.targetBps / 100, terms.triggerBps / 100);
    setSafety(lines.safetyPct);
    setActBelow(lines.actBelowPct);
  }

  function rejectTurnstile() {
    turnstileRef.current = "";
    setNeedsHuman(true);
    setPhase("idle");
    if (retried.current) {
      setError(userMessage("turnstile").sentence);
      return;
    }
    retried.current = true;
    pendingRetry.current = true;
    resetRef.current?.();
  }

  async function claimFault(fault: string) {
    const response = await fetch("/api/lifeline/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const body = (await response.json()) as ClaimBody;
    if (fault === "rate" || response.status === 429) {
      setError(`${userMessage("rate").title}. ${userMessage("rate").sentence}`);
      setOfferDemo(true);
      setPhase("error");
      return;
    }
    if (response.status === 403 && body.error === "turnstile") {
      rejectTurnstile();
      return;
    }
    if (response.status === 503 || body.sandbox) {
      await enterDemo();
      return;
    }
    if (body.proxy && body.position) {
      await applyClaim(body, { userId: "fault", address: "0x68927BE500A643BBDc3bAAac1372fDDD2ffa23d4" });
    }
  }

  async function openPractice() {
    setError("");
    setNotice("");
    setOfferDemo(false);
    setStarted(Date.now());
    const fault = faultName();
    if (fault === "pool" || fault === "rate" || fault === "turnstile") {
      if (fault === "turnstile") {
        const turnstileToken = await token();
        if (!turnstileToken) {
          setNeedsHuman(true);
          setPhase("idle");
          return;
        }
      }
      await claimFault(fault);
      return;
    }
    setPhase("preparing");
    const prepared = await client.prepare();
    if (!prepared.ok) {
      await enterDemo();
      return;
    }
    setPhase("claiming");
    const turnstileToken = await token();
    if (!turnstileToken) {
      setNeedsHuman(true);
      setPhase("idle");
      return;
    }
    const claimed = await client.claim(prepared.session, turnstileToken);
    consumeToken();
    if (claimed.status === 503 || claimed.body.sandbox) {
      await enterDemo();
      return;
    }
    if (claimed.status === 429) {
      setError(`${userMessage("rate").title}. ${userMessage("rate").sentence}`);
      setOfferDemo(true);
      setPhase("error");
      return;
    }
    if (claimed.status === 403 && claimed.body.error === "turnstile") {
      rejectTurnstile();
      return;
    }
    if (claimed.status === 409 && claimed.body.error === "claimed") {
      setNotice(userMessage("claimed").sentence);
      const me = await client.me(prepared.session);
      if (me.claim?.proxy) {
        await applyClaim(
          {
            proxy: me.claim.proxy,
            perpId: me.claim.perpId,
            position: {
              market: me.claim.market || "BTC",
              side: me.claim.side || "long",
              leverage: me.claim.leverage || "1500",
              distanceE6: "32000",
            },
          },
          prepared.session,
        );
        return;
      }
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

  function mandateTerms(testNow: boolean) {
    const distance = BigInt(live?.distanceE6 ?? "0");
    const lines = testNow ? testNowTerms(distance) : clampLines(safetyRef.current, actRef.current);
    return lines;
  }

  async function sign(testNow = false) {
    if (!session || !claim?.proxy || !claim.perpId || !live) return;
    setPhase("signing");
    setError("");
    const terms = mandateTerms(testNow);
    const message = buildMandate({
      account: getAddress(claim.proxy),
      perpIds: [BigInt(claim.perpId)],
      triggerBps: terms.triggerBps,
      targetBps: terms.targetBps,
      maxPerActionCNS: ausdToMicro(capInput, CAP),
      budgetCNS: ausdToMicro(budgetInput, budgetFromFree(BigInt(live.freeCNS ?? "0"))),
      expiry: expiryFromDays(daysInput, Math.floor(Date.now() / 1000)),
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
    const lines = clampLines(safetyRef.current, actRef.current);
    const response = await fetch("/api/lifeline/sandbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proxy: demoProxy,
        triggerBps: lines.triggerBps,
        targetBps: lines.targetBps,
        turnstileToken: turnstileRef.current,
      }),
    });
    consumeToken();
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

  async function pause() {
    if (!session || !claim?.proxy) return;
    const result = await client.disarm(session, claim.proxy, `${Date.now()}`);
    if (result.status !== 200 && result.body.active !== false) {
      setError(userMessage(result.body.error ?? "pause").sentence);
      return;
    }
    setNotice("Paused. Lifeline won't add margin until you resume.");
  }

  function changeSafety(value: number) {
    const act = actTouched.current ? actRef.current : value - 2;
    const next = clampLines(value, act);
    setSafety(next.safetyPct);
    setActBelow(next.actBelowPct);
  }

  function changeAct(value: number) {
    actTouched.current = true;
    const next = clampLines(safetyRef.current, value);
    setSafety(next.safetyPct);
    setActBelow(next.actBelowPct);
  }

  const lines = clampLines(safety, actBelow);
  const distance = live ? distancePctLabel(live.distanceE6) : "";
  const copy = live
    ? [
        safetyCopy(distance, oneDecimal(lines.targetBps), oneDecimal(lines.triggerBps)),
        Number(live.distanceE6) / 100 < lines.triggerBps ? insideLineCopy() : outsideLineCopy(),
      ].join(" ")
    : "";
  const preview = live ? previewTopUp(live, distance, lines.targetBps) : null;

  return {
    ready,
    phase,
    claim,
    live,
    safety,
    actBelow: lines.actBelowPct,
    budgetInput,
    setBudgetInput,
    capInput,
    setCapInput,
    daysInput,
    setDaysInput,
    changeSafety,
    changeAct,
    lines,
    copy,
    preview,
    receipt,
    acceptTx,
    error,
    notice,
    offerDemo,
    needsHuman,
    started,
    elapsed: started && receipt ? Date.now() - started : 0,
    wallet: session?.address ?? "",
    setToken: (value: string) => {
      turnstileRef.current = value;
      if (!value) return;
      if (pendingRetry.current) {
        pendingRetry.current = false;
        void openPractice();
        return;
      }
      setNeedsHuman(false);
    },
    setTurnstileReset: (reset: () => void) => {
      resetRef.current = reset;
    },
    openPractice,
    takeOwnership,
    sign,
    signDemo,
    withdraw,
    pause,
    useDemo: () => void enterDemo(),
    positionLine: live
      ? `${live.market} ${live.side} · ${leverageLabel(live.leverage)} · ${distance} from liquidation${live.freeCNS ? ` · ${formatAusdWhole(live.freeCNS)} idle` : ""}${live.liquidation ? ` · liquidation ${formatPrice(live.liquidation, live.priceDecimals ?? 1)}` : ""}`
      : "",
  };
}
