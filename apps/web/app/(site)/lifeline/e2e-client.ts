import type { ArmBody, ClaimBody } from "../../../lib/try-flow";

export interface TrySession {
  userId: string;
  address: string;
}

export interface SentTx {
  hash: string;
  nonce: number;
}

export interface TryClient {
  prepare(): Promise<{ ok: true; session: TrySession } | { ok: false; sandbox: true }>;
  claim(session: TrySession, turnstileToken: string): Promise<{ status: number; body: ClaimBody }>;
  send(session: TrySession, to: string, data: string, gas: string): Promise<SentTx>;
  arm(session: TrySession, mandate: Record<string, string | number | string[]>): Promise<{ status: number; body: ArmBody }>;
  disarm(session: TrySession, proxy: string, nonce: string): Promise<{ status: number; body: { active?: boolean; error?: string } }>;
  keep(): Promise<void>;
  me(session: TrySession): Promise<{
    claim: {
      proxy?: string;
      perpId?: string;
      market?: string;
      side?: string;
      leverage?: string;
      ownerOnchain?: string;
    } | null;
    mandate: { active?: boolean; kind?: string } | null;
  }>;
  accepted(session: TrySession, txHash: string): Promise<void>;
}

async function act(body: unknown): Promise<Response> {
  return fetch("/api/e2e/act", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const e2eClient: TryClient = {
  async prepare() {
    const response = await act({ op: "prepare" });
    if (!response.ok) return { ok: false, sandbox: true };
    const body = (await response.json()) as { address?: string };
    if (!body.address) return { ok: false, sandbox: true };
    return { ok: true, session: { userId: `did:privy:e2e-${crypto.randomUUID()}`, address: body.address } };
  },
  async claim(session, turnstileToken) {
    const response = await act({ op: "claim", userId: session.userId, nonce: crypto.randomUUID(), turnstileToken });
    return { status: response.status, body: (await response.json()) as ClaimBody };
  },
  async send(_session, to, data, gas) {
    const response = await act({ op: "send", to, data, gas });
    const body = (await response.json()) as { hash?: string; nonce?: number; error?: string };
    if (!response.ok || !body.hash || body.nonce === undefined) throw new Error(body.error ?? "send");
    return { hash: body.hash, nonce: body.nonce };
  },
  async arm(session, mandate) {
    const response = await act({ op: "arm", userId: session.userId, nonce: crypto.randomUUID(), mandate });
    return { status: response.status, body: (await response.json()) as ArmBody };
  },
  async disarm(session, proxy, nonce) {
    const response = await act({ op: "disarm", userId: session.userId, nonce, proxy });
    return { status: response.status, body: (await response.json()) as { active?: boolean; error?: string } };
  },
  async keep() {},
  async me(session) {
    const response = await act({ op: "me", userId: session.userId, nonce: crypto.randomUUID() });
    return (await response.json()) as { claim: { proxy?: string; ownerOnchain?: string } | null; mandate: { active?: boolean; kind?: string } | null };
  },
  async accepted(session, txHash) {
    await act({ op: "accepted", userId: session.userId, nonce: crypto.randomUUID(), txHash });
  },
};
