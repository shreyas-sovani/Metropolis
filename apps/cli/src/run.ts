export function run(argv: readonly string[]): number {
  const command = argv[0];
  if (command === undefined || command === "help" || command === "--help") {
    console.log("lifeline cli");
    console.log("commands are added in later backlog tasks");
    return 0;
  }
  console.error(`unknown command: ${command}`);
  return 1;
}
