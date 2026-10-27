import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Migrations live at the project root, three levels above this file (src/server/db). */
export const MIGRATIONS_FOLDER = path.resolve(here, "../../../drizzle");

/**
 * Apply all pending versioned migrations. Uses its own short-lived pool so it can run
 * before the app pool exists (CLI, tests, deploy step).
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
