import EmbeddedPostgres from "embedded-postgres";
import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { runMigrations } from "@/server/db/migrate";
import { getDb, closeDb } from "@/server/db/client";
import { clearAll, seedDatabase } from "@/server/seed/seed";
import { E2E } from "../tests/e2e/config";

/**
 * Brings up the whole stack for browser tests on fixed local ports: a fresh PostgreSQL cluster,
 * migrations, seed data, the job worker, and the production build. Stays in the foreground until
 * Playwright stops it.
 */
const dataDir = path.resolve(".pgdata-e2e");
const storageDir = path.resolve("storage-e2e");
const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: E2E.databaseUrl,
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: storageDir,
  INBOUND_EMAIL_SECRET: E2E.inboundSecret,
  INBOUND_EMAIL_ADDRESS: "capture@crm.example.com",
  ORG_TIMEZONE: "Europe/Madrid",
  SEED_PASSWORD: E2E.password,
  COOKIE_SECURE: "false",
  WORKER_POLL_MS: "300",
  LOG_LEVEL: "warn",
  NODE_ENV: "production",
};
Object.assign(process.env, env);

const children: ChildProcess[] = [];
let pg: EmbeddedPostgres | undefined;

async function shutdown(code = 0) {
  for (const c of children) c.kill("SIGTERM");
  await closeDb().catch(() => undefined);
  await pg?.stop().catch(() => undefined);
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

async function main() {
  await rm(dataDir, { recursive: true, force: true });
  await rm(storageDir, { recursive: true, force: true });

  pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "aptima", password: "aptima", port: E2E.dbPort, persistent: false, onLog: () => undefined, onError: () => undefined });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("aptima_e2e");

  await runMigrations(E2E.databaseUrl);
  await seedDatabase({ password: E2E.password, timeZone: "Europe/Madrid", db: getDb() });
  await closeDb();

  children.push(spawn("npx", ["tsx", "src/server/jobs/run-worker.ts"], { env, stdio: "inherit", detached: false }));
  children.push(spawn("npx", ["next", "start", "-p", String(E2E.appPort)], { env, stdio: "inherit", detached: false }));
  children.forEach((c) => c.on("exit", (code) => code !== null && code !== 0 && void shutdown(code)));
  console.log(`e2e stack ready on http://localhost:${E2E.appPort}`);
}

main().catch(async (err) => {
  console.error("e2e stack failed:", err);
  await shutdown(1);
});
