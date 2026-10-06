import { describe, expect, it } from "vitest";
import { MAINNET_PROTECTION, dryRunSentence, formatAusd } from "../lib/account";
import { handleAccount } from "../lib/account-route";

describe("account dry-run sentence", () => {
  it("matches the PRD template and adds the mainnet suffix", () => {
    const sentence = dryRunSentence({
      symbol: "BTC",
      side: "long",
      distanceE6: "21000",
      dryRun: { action: "topUp", amountCNS: "152000000" },
      mainnet: true,
    });
    expect(formatAusd("152000000")).toBe("152");
    expect(sentence).toBe(
      `Lifeline would add 152 AUSD from your idle balance to your BTC long → distance 2.1% → 6.0%. ${MAINNET_PROTECTION}`,
    );
    const testnet = dryRunSentence({
      symbol: "BTC",
      side: "long",
      distanceE6: "21000",
      dryRun: { action: "topUp", amountCNS: "152000000" },
      mainnet: false,
    });
    expect(testnet.endsWith(MAINNET_PROTECTION)).toBe(false);
    expect(testnet).toContain("→ distance 2.1% → 6.0%.");
  });

  it("matches live account payloads on mainnet and testnet", async () => {
    const samples = [
      { chain: 143 as const, address: "0x77A89C51f106D6cD547542a3A83FE73cB4459135", mainnet: true },
      { chain: 10143 as const, address: "0xe3929EB4561f70A2Eb1Bc78957CCd0A87dABB362", mainnet: false },
    ];
    for (const sample of samples) {
      const response = await handleAccount(sample.chain, sample.address);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        positions: {
          symbol: string;
          side: "long" | "short";
          entryMicro: string;
          markMicro: string;
          liquidationPricePNS: string;
          distanceE6: string;
          depositMicro: string;
          freeCNS: string;
          dryRun: { action: string; amountCNS?: string };
        }[];
      };
      expect(body.positions.length).toBeGreaterThan(0);
      const position = body.positions[0]!;
      const sentence = dryRunSentence({ ...position, mainnet: sample.mainnet });
      expect(sentence.startsWith("Lifeline would ")).toBe(true);
      expect(sentence.includes(MAINNET_PROTECTION)).toBe(sample.mainnet);
      expect(sentence).toContain(position.symbol);
      expect(sentence).toContain(position.side);
      expect(position.liquidationPricePNS.length).toBeGreaterThan(0);
      expect(position.entryMicro.length).toBeGreaterThan(0);
      expect(position.markMicro.length).toBeGreaterThan(0);
      expect(position.depositMicro.length).toBeGreaterThan(0);
      expect(position.freeCNS.length).toBeGreaterThan(0);
      console.log(
        JSON.stringify({
          chain: sample.chain,
          symbol: position.symbol,
          side: position.side,
          distance: position.distanceE6,
          dry: position.dryRun.action,
          sentence,
        }),
      );
    }
  }, 40_000);
});
