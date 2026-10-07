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
    const urls = [...BOUNTIES.map((bounty) => proofUrl(bounty.proof)), ...JUDGE_PATH.map((step) => proofUrl(step.href)), practice];
    expect(new Set(urls).size).toBe(urls.length);
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
