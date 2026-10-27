import { getConfig } from "@/server/config";
import { runMigrations } from "@/server/db/migrate";
import { logger } from "@/server/log/logger";

/**
 * `npm run db:migrate` — applies versioned migrations to DATABASE_URL and exits.
 * Safe to run repeatedly: drizzle records applied migrations in __drizzle_migrations.
 */
async function main() {
  const url = getConfig().databaseUrl;
  const started = Date.now();
  await runMigrations(url);
  logger.info("db.migrated", { durationMs: Date.now() - started });
}

main().catch((err: unknown) => {
  logger.error("db.migrate_failed", { message: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
