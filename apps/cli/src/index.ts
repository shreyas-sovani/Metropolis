import { run } from "./run.js";

const code = await run(process.argv.slice(2));
process.exit(code);
