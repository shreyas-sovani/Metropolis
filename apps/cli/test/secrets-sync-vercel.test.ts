import { describe, expect, it } from "vitest";
import { PUBLIC_RPC_URLS, TESTNET_ID } from "@lifeline/core";
import { WORKER_ORIGIN, vercelEnvPlan } from "../src/commands/secrets-sync-vercel.js";

describe("vercel env plan", () => {
  it("maps service secrets onto Vercel names and skips an empty client id", () => {
    const plan = vercelEnvPlan(
      new Map([
        ["PRIVY_APP_ID", "app"],
        ["ENVIO_API_TOKEN", "envio"],
        ["RADAR_SALT", "salt"],
        ["TURNSTILE_SITE_KEY", "site"],
        ["ALCHEMY_MONAD_TESTNET_URL", "https://alchemy.example/testnet"],
      ]),
    );
    const byName = new Map(plan.map((item) => [item.name, item]));
    expect(byName.get("NEXT_PUBLIC_PRIVY_APP_ID")).toEqual({
      name: "NEXT_PUBLIC_PRIVY_APP_ID",
      value: "app",
      sensitive: false,
    });
    expect(byName.has("NEXT_PUBLIC_PRIVY_CLIENT_ID")).toBe(false);
    expect(byName.get("NEXT_PUBLIC_WORKER_URL")?.value).toBe(WORKER_ORIGIN);
    expect(byName.get("WORKER_HEALTH_URL")?.value).toBe(`${WORKER_ORIGIN}/health`);
    expect(byName.get("ENVIO_API_TOKEN")?.sensitive).toBe(true);
    expect(byName.get("RADAR_SALT")?.sensitive).toBe(true);
    expect(byName.get("TURNSTILE_SITE_KEY")?.sensitive).toBe(false);
    expect(byName.get("RPC_URLS_TESTNET")?.value.startsWith(PUBLIC_RPC_URLS[TESTNET_ID][0] ?? "")).toBe(true);
    expect(byName.get("RPC_URLS_TESTNET")?.value.endsWith("https://alchemy.example/testnet")).toBe(true);
    expect(byName.get("RPC_URLS_TESTNET")?.sensitive).toBe(true);
  });
});
