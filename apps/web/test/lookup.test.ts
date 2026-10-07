import { describe, expect, it } from "vitest";
import { MAINNET_EXAMPLE, PRACTICE_ACCOUNT } from "../lib/bounties";
import { MAINNET_PROTECTION, dryRunSentence, formatAusd } from "../lib/account";
import { handleAccount } from "../lib/account-route";
import { formatPrice, formatUsd } from "../lib/format";
import { ADDRESS_ERROR } from "../lib/landing";
import {
  DASHBOARD_ACTION,
  MAINNET_ACTION,
  NO_POSITIONS,
  PRACTICE_ACTION,
  accountOutcome,
  cardModel,
  checkTarget,
  exampleHref,
  leverageTimes,
  noAccountSentence,
  readPracticeProxy,
  reportAction,
  CHECK_EXAMPLES,
  type ReportPosition,
} from "../lib/report";

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
      { chain: 143 as const, address: MAINNET_EXAMPLE, mainnet: true },
      { chain: 10143 as const, address: PRACTICE_ACCOUNT, mainnet: false },
    ];
    for (const sample of samples) {
      const response = await handleAccount(sample.chain, sample.address);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        found?: boolean;
        idleMicro?: string;
        positions: ReportPosition[];
      };
      expect(body.found).toBe(true);
      expect(body.positions.length).toBeGreaterThan(0);
      const position = body.positions[0]!;
      expect(position.liquidationMicro).toBeTruthy();
      expect(position.priceDecimals).toBeGreaterThanOrEqual(0);
      const card = cardModel(position, sample.mainnet);
      expect(card.liquidation.startsWith("$")).toBe(true);
      expect(card.liquidation).toBe(formatPrice(position.liquidationMicro!, position.priceDecimals!));
      expect(card.entry).toBe(formatPrice(position.entryMicro, position.priceDecimals!));
      expect(card.mark).toBe(formatPrice(position.markMicro, position.priceDecimals!));
      expect(card.margin).toBe(formatUsd(position.depositMicro));
      expect(card.idle).toBe(`${formatAusd(position.freeCNS)} AUSD`);
      expect(card.forfeit).toBe(`If liquidated now you'd forfeit about ${formatUsd(position.forfeitCNS ?? "0")}.`);
      expect(card.attrs.liq).toBe(position.liquidationPricePNS);
      expect(card.attrs.entry).toBe(position.entryMicro);
      expect(card.attrs.free).toBe(position.freeCNS);
      expect(card.dryRun).toBe(dryRunSentence({ ...position, mainnet: sample.mainnet }));
      expect(card.dryRun.startsWith("Lifeline would ")).toBe(true);
      expect(card.dryRun.includes(MAINNET_PROTECTION)).toBe(sample.mainnet);
      expect(card.dryRun).toContain(position.symbol);
      expect(card.dryRun).toContain(position.side);
      console.log(
        JSON.stringify({
          chain: sample.chain,
          symbol: position.symbol,
          side: position.side,
          liquidation: card.liquidation,
          title: card.title,
          dry: position.dryRun.action,
        }),
      );
    }
  }, 40_000);
});

const fixture: ReportPosition = {
  perpId: 16,
  symbol: "BTC",
  side: "long",
  entryMicro: "80000000000",
  markMicro: "83702300000",
  liquidationPricePNS: "837023",
  liquidationMicro: "83702300000",
  priceDecimals: 1,
  distanceE6: "32000",
  depositMicro: "200000000",
  freeCNS: "300000000",
  forfeitCNS: "160000000",
  notionalMicro: "3000000000",
  dryRun: { action: "topUp", amountCNS: "61000000" },
};

describe("check and risk report", () => {
  it("keeps an invalid address on the form", () => {
    expect(checkTarget("not-an-address", "143")).toEqual({ error: ADDRESS_ERROR });
    expect(checkTarget("  0x77A89C51f106D6cD547542a3A83FE73cB4459135  ", "10143")).toEqual({
      href: `/a/${MAINNET_EXAMPLE}?chain=10143`,
    });
  });

  it("offers both examples and the empty-state sentences", () => {
    expect(CHECK_EXAMPLES.map((example) => example.label)).toEqual(["A live mainnet account", "A testnet practice account"]);
    expect(exampleHref(CHECK_EXAMPLES[0]!)).toBe(`/a/${MAINNET_EXAMPLE}?chain=143`);
    expect(exampleHref(CHECK_EXAMPLES[1]!)).toBe(`/a/${PRACTICE_ACCOUNT}?chain=10143`);
    expect(noAccountSentence(true)).toBe("This address has no Perpl account on mainnet.");
    expect(noAccountSentence(false)).toBe("This address has no Perpl account on testnet.");
    expect(NO_POSITIONS).toBe("This account has no open positions.");
    expect(accountOutcome({ found: false, positions: [] })).toBe("missing");
    expect(accountOutcome({ accountId: "0", positions: [{ ...fixture }] })).toBe("missing");
    expect(accountOutcome({ found: true, positions: [] })).toBe("flat");
    expect(accountOutcome({ positions: [] })).toBe("flat");
    expect(accountOutcome({ found: true, positions: [fixture] })).toBe("ready");
  });

  it("routes the action to /app", () => {
    expect(reportAction({ mainnet: true, address: MAINNET_EXAMPLE, practice: PRACTICE_ACCOUNT })).toEqual({
      label: MAINNET_ACTION,
      href: "/app",
    });
    expect(reportAction({ mainnet: false, address: PRACTICE_ACCOUNT, practice: PRACTICE_ACCOUNT })).toEqual({
      label: DASHBOARD_ACTION,
      href: "/app",
    });
    expect(reportAction({ mainnet: false, address: MAINNET_EXAMPLE, practice: PRACTICE_ACCOUNT })).toEqual({
      label: PRACTICE_ACTION,
      href: "/app",
    });
  });

  it("renders the card in dollars from the account payload", () => {
    const card = cardModel(fixture, true);
    expect(card.title).toBe("BTC long · 15×");
    expect(card.liquidation).toBe("$83,702.3");
    expect(card.entry).toBe("$80,000.0");
    expect(card.mark).toBe("$83,702.3");
    expect(card.margin).toBe("$200");
    expect(card.idle).toBe("300 AUSD");
    expect(card.forfeit).toBe("If liquidated now you'd forfeit about $160.");
    expect(card.dryRun).toContain(MAINNET_PROTECTION);
    expect(card.attrs.liq).toBe("837023");
    expect(leverageTimes("100", "0")).toBeNull();
    expect(cardModel({ ...fixture, notionalMicro: undefined }, false).title).toBe("BTC long");
  });

  it("reads the signed-in practice account", async () => {
    const found = async () => Response.json({ claim: { proxy: PRACTICE_ACCOUNT } });
    expect(await readPracticeProxy(found as typeof fetch)).toBe(PRACTICE_ACCOUNT);
    const empty = async () => Response.json({ claim: null });
    expect(await readPracticeProxy(empty as typeof fetch)).toBeNull();
  });
});
