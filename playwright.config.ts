import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const DB = process.env.E2E_DATABASE_URL ?? "postgres://life:life@localhost:5432/life_e2e";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 900 } } },
  ],
  webServer: {
    command: `npx tsx tests/e2e/reset-db.ts && npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/manifest.webmanifest`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: DB, APP_ORIGIN: `http://localhost:${PORT}`, OWNER_EMAIL: "owner@example.com",
      DATA_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", AUTH_PEPPER: "cGVwcGVyLWZvci10ZXN0cy1vbmx5LW5vdC1yZWFsLTEyMw==",
      CRON_SECRET: "e2e-cron-secret", AI_PROVIDER: "offline", DEV_EMAIL_OUTBOX: "/tmp/ld-e2e-outbox.jsonl",
      VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY ?? "", VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY ?? "",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
