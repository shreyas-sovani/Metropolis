import { afterAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { unstable_dev, type Unstable_DevWorker } from "wrangler";
import { walletProofMessage } from "../src/privy.js";

describe("claim http", () => {
  let worker: Unstable_DevWorker;

  afterAll(async () => {
    await worker?.stop();
  });

  it("returns 401 without a proof and 503 sandbox when the pool is empty", async () => {
    worker = await unstable_dev("src/index.ts", {
      config: "wrangler.toml",
      local: true,
      logLevel: "error",
      vars: { ADMIN_SECRET: "claim-test" },
      experimental: { disableExperimentalWarning: true },
      persist: false,
    });
    const missing = await worker.fetch("http://127.0.0.1/claim", { method: "POST" });
    expect(missing.status).toBe(401);

    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = "claim-1";
    const user = "did:privy:claim-empty";
    const signature = await account.signMessage({
      message: walletProofMessage(user, account.address, nonce),
    });
    const empty = await worker.fetch("http://127.0.0.1/claim", {
      method: "POST",
      headers: {
        "x-admin-secret": "claim-test",
        "x-lifeline-user": user,
        "x-lifeline-address": account.address,
        "x-lifeline-signature": signature,
        "x-lifeline-nonce": nonce,
      },
    });
    expect(await empty.json()).toEqual({ error: "empty", sandbox: true });
    expect(empty.status).toBe(503);
  }, 60_000);
});
