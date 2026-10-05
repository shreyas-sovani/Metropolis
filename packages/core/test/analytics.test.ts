import { encodeAbiParameters } from "viem";
import { describe, expect, it } from "vitest";
import {
  blocksForDays,
  filterLifelineActions,
  idleAtLiquidation,
  summarizeLiquidations,
} from "../src/hypersync/analytics.js";
import { decodeIncreasePositionCollateral, decodePositionLiquidated, type HyperSyncLog } from "../src/hypersync/decode.js";
import { eventAbi, eventTopic0 } from "../src/hypersync/topics.js";

function liquidatedLog(fields: {
  block: number;
  perpId: bigint;
  accAmountCNS: bigint;
  accBalanceCNS: bigint;
  posDepositCNS: bigint;
  markPricePNS: bigint;
  liqLotLNS: bigint;
}): HyperSyncLog {
  const event = eventAbi("PositionLiquidated");
  return {
    block_number: fields.block,
    topic0: eventTopic0("PositionLiquidated"),
    data: encodeAbiParameters(event.inputs, [
      fields.perpId,
      7n,
      0,
      fields.markPricePNS,
      80_000n,
      fields.liqLotLNS,
      0n,
      0n,
      0n,
      0n,
      fields.posDepositCNS,
      fields.accAmountCNS,
      fields.accBalanceCNS,
      false,
    ]),
  };
}

describe("hypersync analytics", () => {
  it("sums rows, flags idle eligibility, and keeps the latest 50", () => {
    const logs = [
      liquidatedLog({
        block: 3,
        perpId: 1n,
        accAmountCNS: 2n,
        accBalanceCNS: 10n,
        posDepositCNS: 4n,
        markPricePNS: 100n,
        liqLotLNS: 2n,
      }),
      liquidatedLog({
        block: 1,
        perpId: 1n,
        accAmountCNS: -5n,
        accBalanceCNS: 1n,
        posDepositCNS: 9n,
        markPricePNS: 50n,
        liqLotLNS: 1n,
      }),
    ];
    const events = logs.map((log) => decodePositionLiquidated(log));
    expect(idleAtLiquidation(events[0]!)).toBe(8n);
    expect(idleAtLiquidation(events[1]!)).toBe(1n);
    const history = summarizeLiquidations(events, new Map([["1", { priceDecimals: 0, lotDecimals: 0 }]]));
    expect(history.totals.count).toBe(history.rows.length);
    expect(BigInt(history.totals.notionalMicro)).toBe(
      history.rows.reduce((sum, row) => sum + BigInt(row.notionalMicro), 0n),
    );
    expect(history.rows[0]?.eligible).toBe(false);
    expect(history.rows[1]?.eligible).toBe(true);
    expect(history.eligible.count).toBe(1);
    expect(history.latest).toHaveLength(2);

    const extra = Array.from({ length: 60 }, (_, index) =>
      decodePositionLiquidated(
        liquidatedLog({
          block: index,
          perpId: 1n,
          accAmountCNS: 0n,
          accBalanceCNS: 1n,
          posDepositCNS: 1n,
          markPricePNS: 1n,
          liqLotLNS: 1n,
        }),
      ),
    );
    expect(summarizeLiquidations(extra, new Map()).latest).toHaveLength(50);
  });

  it("filters collateral increases to the requested accounts", () => {
    const event = eventAbi("IncreasePositionCollateral");
    const logs = [4n, 8n].map((accountId, index) =>
      decodeIncreasePositionCollateral({
        block_number: index + 1,
        log_index: index,
        topic0: eventTopic0("IncreasePositionCollateral"),
        data: encodeAbiParameters(event.inputs, [1n, accountId, 3n, 5n, 6n]),
      }),
    );
    const actions = filterLifelineActions(logs, [8n]);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.accountId).toBe("8");
  });

  it("estimates the block span for a day count", () => {
    expect(blocksForDays(10_000n, 20_000n, 0n, 0n, 1)).toBe(43_200n);
  });
});
