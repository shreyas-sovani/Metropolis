import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";

for (const engine of ["chrome"]) {
  test(`Turnstile stays invisible in ${engine}`, () => {
    test.setTimeout(60_000);
    const env = { ...process.env };
    delete env.PLAYWRIGHT_TEST;
    const result = spawnSync("node", ["e2e/turnstile-check.mjs", engine], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    expect(result.status).toBe(0);
  });
}
