import { recoverMessageAddress } from "viem";

export interface PrivyIdentity {
  userId: string;
  address: string | null;
}

export type PrivyFailure = { ok: false; status: 401 };
export type PrivySuccess = { ok: true; identity: PrivyIdentity };

const ISSUER = "privy.io";

function bytesFromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function jsonFromBase64Url(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytesFromBase64Url(value))) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function spkiBytes(verificationKey: string): Uint8Array<ArrayBuffer> {
  const body = verificationKey
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");
  return bytesFromBase64Url(body);
}

function audienceMatches(audience: unknown, appId: string): boolean {
  if (typeof audience === "string") return audience === appId;
  if (Array.isArray(audience)) return audience.some((item) => item === appId);
  return false;
}

function walletFromClaims(payload: Record<string, unknown>): string | null {
  const linked = payload.linked_accounts;
  const list = Array.isArray(linked) ? linked : [];
  for (const account of list) {
    if (!account || typeof account !== "object") continue;
    const record = account as Record<string, unknown>;
    const address = record.address;
    const chain = record.chain_type ?? record.chainType;
    if (typeof address === "string" && address.startsWith("0x") && (chain === "ethereum" || chain === undefined)) {
      return address;
    }
  }
  return null;
}

export async function verifyPrivyAccessToken(
  token: string,
  options: { verificationKey: string; appId: string; nowSec?: number },
): Promise<PrivySuccess | PrivyFailure> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, status: 401 };
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return { ok: false, status: 401 };
  const header = jsonFromBase64Url(headerPart);
  const payload = jsonFromBase64Url(payloadPart);
  if (!header || !payload || header.alg !== "ES256") return { ok: false, status: 401 };
  const key = await crypto.subtle.importKey(
    "spki",
    spkiBytes(options.verificationKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    bytesFromBase64Url(signaturePart),
    signed,
  );
  if (!valid) return { ok: false, status: 401 };
  if (payload.iss !== ISSUER) return { ok: false, status: 401 };
  if (!audienceMatches(payload.aud, options.appId)) return { ok: false, status: 401 };
  const now = options.nowSec ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) return { ok: false, status: 401 };
  if (typeof payload.sub !== "string" || payload.sub.length === 0) return { ok: false, status: 401 };
  return { ok: true, identity: { userId: payload.sub, address: walletFromClaims(payload) } };
}

export function walletProofMessage(userId: string, address: string, nonce: string): string {
  return `lifeline:${userId}:${address}:${nonce}`;
}

/** Access tokens omit the wallet. A signature over the user id is the check that the address belongs to this session. */
export async function addressFromWalletProof(input: {
  userId: string;
  address: string;
  nonce: string;
  signature: `0x${string}`;
}): Promise<string | null> {
  try {
    const recovered = await recoverMessageAddress({
      message: walletProofMessage(input.userId, input.address, input.nonce),
      signature: input.signature,
    });
    return recovered.toLowerCase() === input.address.toLowerCase() ? recovered : null;
  } catch {
    return null;
  }
}
