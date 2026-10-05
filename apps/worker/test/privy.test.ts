import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { addressFromWalletProof, verifyPrivyAccessToken, walletProofMessage } from "../src/privy.js";

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

async function testKey(): Promise<{ spki: string; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  let binary = "";
  for (const byte of spki) binary += String.fromCharCode(byte);
  return { spki: btoa(binary), privateKey: pair.privateKey };
}

async function signToken(privateKey: CryptoKey, payload: Record<string, unknown>, headerAlg = "ES256"): Promise<string> {
  const header = encodeJson({ alg: headerAlg, typ: "JWT" });
  const body = encodeJson(payload);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(`${header}.${body}`)),
  );
  return `${header}.${body}.${b64url(signature)}`;
}

describe("privy access tokens", () => {
  it("rejects expired, tampered, and wrong-audience tokens", async () => {
    const { spki, privateKey } = await testKey();
    const appId = "app-test";
    const now = 1_700_000_000;
    const good = await signToken(privateKey, {
      iss: "privy.io",
      aud: appId,
      sub: "did:privy:guest",
      exp: now + 60,
    });
    const accepted = await verifyPrivyAccessToken(good, { verificationKey: spki, appId, nowSec: now });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.identity.userId).toBe("did:privy:guest");

    const expired = await signToken(privateKey, {
      iss: "privy.io",
      aud: appId,
      sub: "did:privy:guest",
      exp: now - 1,
    });
    expect(await verifyPrivyAccessToken(expired, { verificationKey: spki, appId, nowSec: now })).toEqual({
      ok: false,
      status: 401,
    });

    const wrongAudience = await signToken(privateKey, {
      iss: "privy.io",
      aud: "other-app",
      sub: "did:privy:guest",
      exp: now + 60,
    });
    expect(await verifyPrivyAccessToken(wrongAudience, { verificationKey: spki, appId, nowSec: now })).toEqual({
      ok: false,
      status: 401,
    });

    const [header, payload, signature] = good.split(".");
    const tamperedPayload = `${payload?.slice(0, -2)}aa`;
    const tampered = `${header}.${tamperedPayload}.${signature}`;
    expect(await verifyPrivyAccessToken(tampered, { verificationKey: spki, appId, nowSec: now })).toEqual({
      ok: false,
      status: 401,
    });
  });

  it("accepts a wallet only when the signature recovers to that address", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const message = walletProofMessage("did:privy:guest", account.address, "nonce-1");
    const signature = await account.signMessage({ message });
    const address = await addressFromWalletProof({
      userId: "did:privy:guest",
      address: account.address,
      nonce: "nonce-1",
      signature,
    });
    expect(address?.toLowerCase()).toBe(account.address.toLowerCase());
    const wrong = await addressFromWalletProof({
      userId: "did:privy:other",
      address: account.address,
      nonce: "nonce-1",
      signature,
    });
    expect(wrong).toBeNull();
  });
});
