import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Server-only. Reads a name from the environment, then from gitignored secrets/services.env. */
export function readSecret(name: string): string {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  let dir = process.cwd();
  for (let hop = 0; hop < 5; hop += 1) {
    const file = path.join(dir, "secrets", "services.env");
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.startsWith(`${name}=`)) continue;
        return line.slice(name.length + 1).trim();
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}
