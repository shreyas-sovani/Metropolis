import { verifyAddresses } from "./commands/verify-addresses.js";

export async function run(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  if (command === undefined || command === "help" || command === "--help") {
    console.log("lifeline cli");
    console.log("  verify:addresses");
    return 0;
  }
  if (command === "verify:addresses") return verifyAddresses();
  console.error(`unknown command: ${command}`);
  return 1;
}
