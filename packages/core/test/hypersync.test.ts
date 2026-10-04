import { encodeAbiParameters, keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { paginateLogs, type HyperSyncFetch } from "../src/hypersync/client.js";
import { decodeIncreasePositionCollateral, decodePositionLiquidated } from "../src/hypersync/decode.js";
import { eventAbi, eventTopic0 } from "../src/hypersync/topics.js";

describe("hypersync topics", () => {
  it("derives topic0 from the ABI signature", () => {
    for (const name of ["PositionLiquidated", "IncreasePositionCollateral"] as const) {
      const event = eventAbi(name);
      const signature = `${event.name}(${event.inputs.map((input) => input.type).join(",")})`;
      expect(eventTopic0(name)).toBe(keccak256(toBytes(signature)));
    }
  });
});

describe("hypersync decode", () => {
  it("round-trips PositionLiquidated", () => {
    const event = eventAbi("PositionLiquidated");
    const data = encodeAbiParameters(event.inputs, [
      1n,
      9n,
      0,
      85_000n,
      80_000n,
      3n,
      4n,
      -5n,
      6n,
      -7n,
      8n,
      9n,
      10n,
      false,
    ]);
    const decoded = decodePositionLiquidated({
      block_number: 12,
      data,
      topic0: eventTopic0("PositionLiquidated"),
    });
    expect(decoded.perpId).toBe(1n);
    expect(decoded.posLotLNS).toBe(4n);
    expect(decoded.liqLotLNS).toBe(3n);
    expect(decoded.deltaPnlCNS).toBe(-5n);
    expect(decoded.onOrderBook).toBe(false);
    expect(decoded.blockNumber).toBe(12);
  });

  it("round-trips IncreasePositionCollateral", () => {
    const event = eventAbi("IncreasePositionCollateral");
    const data = encodeAbiParameters(event.inputs, [2n, 3n, 4n, 5n, 6n]);
    const decoded = decodeIncreasePositionCollateral({
      block_number: 8,
      data,
      topic0: eventTopic0("IncreasePositionCollateral"),
    });
    expect(decoded.amountCNS).toBe(5n);
    expect(decoded.accountId).toBe(3n);
  });
});

describe("hypersync pagination", () => {
  it("follows next_block until the archive head, including an empty page", async () => {
    const pages = [
      { next_block: 10, archive_height: 25, data: [{ logs: [{ block_number: 4, data: "0x", topic0: "0x11" }] }] },
      { next_block: 25, archive_height: 25, data: [{ logs: [] }] },
    ];
    const fetchImpl: HyperSyncFetch = async () => ({
      status: 200,
      json: async () => pages.shift(),
    });
    const result = await paginateLogs({
      endpoint: "https://example.test",
      token: "test-token",
      fromBlock: 0,
      address: "0x0000000000000000000000000000000000000001",
      fetchImpl,
    });
    expect(result.pages).toBe(2);
    expect(result.logs).toHaveLength(1);
    expect(result.nextBlock).toBe(25);
    expect(result.archiveHeight).toBe(25);
  });
});
