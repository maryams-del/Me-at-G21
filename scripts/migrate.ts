import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, closeDb } from "../src/db";

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL not set — skipping migrations (add the Neon database to the Vercel project).");
} else {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied");
  await closeDb();
}
