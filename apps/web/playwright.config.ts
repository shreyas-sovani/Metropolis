import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

function publicAppId(): string {
  try {
    const file = readFileSync(path.resolve(__dirname, "../../secrets/services.env"), "utf8");
    const line = file.split("\n").find((item) => item.startsWith("PRIVY_APP_ID="));
    return line?.slice("PRIVY_APP_ID=".length).trim() ?? "";
  } catch {
    return "";
  }
}

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
        env: { NEXT_PUBLIC_PRIVY_APP_ID: publicAppId() },
      },
});
