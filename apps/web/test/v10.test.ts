import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HEALTH_FIELDS,
  LIQUIDATION_FIELDS,
  RATE_LIMIT_MESSAGE,
  RISK_ACCOUNT_FIELDS,
  RISK_EXAMPLE,
  RISK_PARAMS,
  RISK_POSITION_FIELDS,
  liquidationPriceFromRisk,
  riskCurl,
  runPanel,
} from "../lib/api-docs";
import { allowRequest } from "../lib/rate";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("developers docs", () => {
  it("names every field the risk and health routes actually return", () => {
    const risk = source("../app/api/v1/risk/[address]/route.ts") + source("../lib/account-route.ts") + source("../lib/account.ts");
    const history = source("../../../packages/core/src/hypersync/analytics.ts") + source("../../../packages/core/src/hypersync/history.ts");
    const health = source("../../../apps/worker/src/health.ts");
    for (const field of [...RISK_PARAMS, ...RISK_ACCOUNT_FIELDS, ...RISK_POSITION_FIELDS]) {
      expect(risk, field.name).toContain(field.name === "address" ? "address" : field.name);
    }
    for (const field of LIQUIDATION_FIELDS) {
      const leaf = field.name.split(".").pop() ?? field.name;
      expect(history, field.name).toContain(leaf);
    }
    for (const field of HEALTH_FIELDS) expect(health, field.name).toContain(field.name);
  });

  it("builds a curl for the example account", () => {
    expect(riskCurl()).toBe(
      `curl "https://lifeline-five-murex.vercel.app/api/v1/risk/${RISK_EXAMPLE}?chain=143"`,
    );
  });

  it("shows the limit message on the 61st call within a minute", () => {
    const hits: number[] = [];
    let status = 200;
    for (let index = 0; index < 61; index += 1) status = allowRequest(hits, 1_000) ? 200 : 429;
    expect(status).toBe(429);
    const panel = runPanel(status, '{"error":"rate"}', 12);
    expect(panel.message).toBe(RATE_LIMIT_MESSAGE);
    expect(panel.status).toBe(429);
    expect(panel.latency).toBe("12 ms");
    expect(panel.json).toContain('"error"');
  });

  it("reads the liquidation price the Run panel compares to the account route", () => {
    expect(liquidationPriceFromRisk({ positions: [{ liquidationPricePNS: "837023" }] })).toBe("837023");
    expect(liquidationPriceFromRisk({ positions: [] })).toBeNull();
    expect(runPanel(200, '{"positions":[]}', 3).message).toBe("");
  });
});
