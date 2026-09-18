import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    // A dedicated test port, so an ordinary `npm start`/`npm run dev` server on
    // 8787 can never be silently reused (it would lack the test reset route and
    // leak state between tests).
    baseURL: "http://localhost:8799",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npx vite build && TICKETS_TEST=1 PORT=8799 npx tsx src/server/main.ts",
    url: "http://localhost:8799/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
