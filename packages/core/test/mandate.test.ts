import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mandateDomain, mandateMessage, mandateTypes } from "../src/lifeline/mandate.js";

describe("mandate", () => {
  it("recovers the signer of the PRD §F5 typed data", async () => {
    const account = privateKeyToAccount(`0x${"33".repeat(32)}`);
    const message = mandateMessage({
      account: "0x00000000000000000000000000000000000000b1",
      perpId: 16n,
    });
    const signature = await account.signTypedData({
      domain: mandateDomain(),
      types: mandateTypes,
      primaryType: "Mandate",
      message,
    });
    const recovered = await recoverTypedDataAddress({
      domain: mandateDomain(),
      types: mandateTypes,
      primaryType: "Mandate",
      message,
      signature,
    });
    expect(recovered).toBe(account.address);
    expect(message.triggerBps).toBe(400);
    expect(message.targetBps).toBe(600);
  });
});