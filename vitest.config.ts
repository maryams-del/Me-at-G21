import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://life:life@localhost:5432/life_test",
      DATA_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      AUTH_PEPPER: "cGVwcGVyLWZvci10ZXN0cy1vbmx5LW5vdC1yZWFsLTEyMw==",
      APP_ORIGIN: "http://localhost:3000",
      OWNER_EMAIL: "owner@example.com",
      AI_PROVIDER: "offline",
      LOCAL_BLOB_DIR: "/tmp/ld-test-blobs",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
});
