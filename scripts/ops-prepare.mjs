import { existsSync, mkdirSync, writeFileSync } from "node:fs";

function seed(name, raw) {
  const file = `cli-state/${name}`;
  if (existsSync(file)) {
    console.log(`${name} restored`);
    return;
  }
  if (!raw || !raw.startsWith("{")) {
    console.error(`${name} missing`);
    process.exit(1);
  }
  writeFileSync(file, raw.endsWith("\n") ? raw : `${raw}\n`, { mode: 0o600 });
  console.log(`${name} seeded`);
}

mkdirSync("cli-state", { recursive: true });
mkdirSync("secrets", { recursive: true });
seed("pool.json", process.env.POOL_JSON ?? "");
seed("twins.json", process.env.TWINS_JSON ?? "");

const names = ["SPONSOR_PK", "OPERATOR_PK", "POOL_OWNER_PK", "MAKER_PK", "CALIBRATION_PK", "TEST_OWNER_PK"];
const lines = [];
for (const name of names) {
  const value = process.env[name] ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    console.error(`${name} missing`);
    process.exit(1);
  }
  lines.push(`${name}=${value}`);
}
writeFileSync("secrets/testnet-keys.env", `${lines.join("\n")}\n`, { mode: 0o600 });
const alchemy = process.env.ALCHEMY_MONAD_TESTNET_URL ?? "";
const serviceLines = [];
if (alchemy.startsWith("https://")) serviceLines.push(`ALCHEMY_MONAD_TESTNET_URL=${alchemy}`);
for (const name of ["ADMIN_SECRET", "PROXY_SECRET"]) {
  const value = process.env[name] ?? "";
  if (!value) {
    console.error(`${name} missing`);
    process.exit(1);
  }
  serviceLines.push(`${name}=${value}`);
}
writeFileSync("secrets/services.env", `${serviceLines.join("\n")}\n`, { mode: 0o600 });
console.log("testnet keys written");
