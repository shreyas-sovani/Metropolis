import { faucetAusd } from "./commands/faucet-ausd.js";
import { gate5 } from "./commands/gate-5.js";
import { gate6 } from "./commands/gate-6.js";
import { gate8 } from "./commands/gate-8.js";
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
    console.log("  gate:5");
    console.log("  gate:6");
    console.log("  gate:8");
    return 0;
  }
  if (command === "verify:addresses") return verifyAddresses();
  if (command === "keys:generate") return keysGenerate();
  if (command === "status") return status();
  if (command === "fund:mon") return fundMon();
  if (command === "faucet:ausd") return faucetAusd();
  if (command === "gate:5") return gate5();
  if (command === "gate:6") return gate6();
  if (command === "gate:8") return gate8();
  console.error(`unknown command: ${command}`);
  return 1;
}
