import type { Abi } from "viem";
import artifact from "./Exchange.json" with { type: "json" };

/** MIT ABI from PerplFoundation/dex-sdk @ dbb37c59. See EXCHANGE-LICENSE.txt. */
export const exchangeAbi = artifact.abi as Abi;
