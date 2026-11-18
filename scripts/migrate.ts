import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, closeDb } from "../src/db";

await migrate(getDb(), { migrationsFolder: "./drizzle" });
console.log("Migrations applied");
await closeDb();
