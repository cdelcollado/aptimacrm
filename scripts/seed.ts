import { getConfig } from "@/server/config";
import { getDb, closeDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { clearAll, seedDatabase, SEED_USERS } from "@/server/seed/seed";

/**
 * `npm run db:seed` — migrates, clears, and loads the demo dataset. Development only: it wipes data.
 * Refuses to run when NODE_ENV=production unless ALLOW_SEED_IN_PRODUCTION=yes.
 */
async function main() {
  const cfg = getConfig();
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED_IN_PRODUCTION !== "yes") {
    throw new Error("Refusing to seed a production database");
  }
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12) throw new Error("SEED_PASSWORD (12+ characters) is required");

  await runMigrations(cfg.databaseUrl);
  const db = getDb();
  await clearAll(db);
  await seedDatabase({ password, timeZone: cfg.orgTimezone, db });
  console.log("Seeded. Sign in with:");
  for (const u of SEED_USERS) console.log(`  ${u.role.padEnd(12)} ${u.email}  (password from SEED_PASSWORD)`);
  await closeDb();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
