import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/** DATABASE_URL, or the name the Vercel–Neon integration created with the ME_AT_G21 prefix. */
export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.ME_AT_G21_URL;
}

export type DB = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction — services accept either. */
export type Tx = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

const g = globalThis as unknown as { __pool?: Pool; __db?: DB };

export function getDb(): DB {
  if (!g.__db) {
    const url = databaseUrl();
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__pool = new Pool({ connectionString: url, max: process.env.VERCEL ? 3 : 10 });
    g.__db = drizzle(g.__pool, { schema });
  }
  return g.__db;
}

export async function closeDb() {
  await g.__pool?.end();
  g.__pool = undefined;
  g.__db = undefined;
}

export { schema };
