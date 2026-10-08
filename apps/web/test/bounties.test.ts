import { describe, expect, it } from "vitest";
import { BOUNTIES, JUDGE_PATH, PRACTICE_ACCOUNT, PRACTICE_LOOKUP, proofUrl } from "../lib/bounties";

async function txExists(url: string): Promise<boolean> {
  const hash = url.split("/tx/")[1] ?? "";
  const response = await fetch("https://testnet-rpc.monad.xyz", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [hash] }),
  });
  const body = (await response.json()) as { result?: { hash?: string } | null };
  return body.result?.hash?.toLowerCase() === hash.toLowerCase();
}

describe("judge proofs", () => {
  it("every bounty and judge-path link answers", async () => {
    const practice = proofUrl(PRACTICE_LOOKUP);
    expect(practice).toContain(PRACTICE_ACCOUNT);
    expect(BOUNTIES.find((bounty) => bounty.name === "Perpl Analytics")?.proof).toBe("/radar");
    expect(BOUNTIES.find((bounty) => bounty.name === "Perpl API")?.proof).toBe("/developers");
    expect(BOUNTIES.find((bounty) => bounty.name === "Privy")?.proof).toBe("/app");
    expect(BOUNTIES.find((bounty) => bounty.name === "Privy")?.also?.href).toContain("/tx/0x");
    expect(BOUNTIES.find((bounty) => bounty.name === "Track 1")?.proof).toBe("/twins");
    expect(BOUNTIES.find((bounty) => bounty.name === "Track 1")?.also?.href).toContain("/tx/0x");
    expect(BOUNTIES.find((bounty) => bounty.name === "Envio")?.proof).toBe("/api/liquidations");
    expect(BOUNTIES.find((bounty) => bounty.name === "Envio")?.also?.href).toBe("/radar");
    expect(JUDGE_PATH.map((step) => step.href)).toEqual(["/radar", "/replay", "/app", "/twins", "/tour/evidence"]);
    const urls = [
      ...new Set([
        ...BOUNTIES.flatMap((bounty) => [bounty.proof, bounty.also?.href].filter((href): href is string => Boolean(href))),
        ...JUDGE_PATH.map((step) => step.href),
        PRACTICE_LOOKUP,
      ].map((href) => proofUrl(href))),
    ];
    for (const url of urls) {
      if (url.includes("/tx/0x")) {
        expect(await txExists(url), url).toBe(true);
        continue;
      }
      const response = await fetch(url, { redirect: "follow" });
      expect(response.status, url).toBeLessThan(400);
    }
  }, 60_000);
});
