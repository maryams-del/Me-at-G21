import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { rmSync } from "node:fs";

export default async function setup() {
  const pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL ?? "postgres://life:life@localhost:5432/life_e2e" });
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
  rmSync("/tmp/ld-e2e-outbox.jsonl", { force: true });
}
