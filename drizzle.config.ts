import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL || process.env.ME_AT_G21_DATABASE_URL || "postgres://life:life@localhost:5432/life_dev" },
});
