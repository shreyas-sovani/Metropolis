import { faucetAusd } from "./commands/faucet-ausd.js";
import { fundMon } from "./commands/fund-mon.js";
import { keysGenerate } from "./commands/keys-generate.js";
import { status } from "./commands/status.js";
import { verifyAddresses } from "./commands/verify-addresses.js";

export async function run(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  if (command === undefined || command === "help" || command === "--help") {
    console.log("lifeline cli");
    console.log("  verify:addresses");
    console.log("  keys:generate");
    console.log("  status");
    console.log("  fund:mon");
    console.log("  faucet:ausd");
    return 0;
  }
  if (command === "verify:addresses") return verifyAddresses();
  if (command === "keys:generate") return keysGenerate();
  if (command === "status") return status();
  if (command === "fund:mon") return fundMon();
  if (command === "faucet:ausd") return faucetAusd();
  console.error(`unknown command: ${command}`);
  return 1;
}
