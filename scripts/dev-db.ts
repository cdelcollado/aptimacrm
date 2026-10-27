import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * `npm run db:dev` — runs a local PostgreSQL 18 with no Docker (binaries come from the embedded-postgres
 * npm package). Data lives in .pgdata-dev. Matches the DATABASE_URL in .env.example.
 */
const PORT = Number(process.env.DEV_PG_PORT ?? 54320);
const dataDir = path.resolve(".pgdata-dev");
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "aptima", password: "aptima", port: PORT, persistent: true });

async function main() {
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase("aptimacrm");
  } catch {
    // already exists
  }
  console.log(`PostgreSQL ready on postgres://aptima:aptima@127.0.0.1:${PORT}/aptimacrm (Ctrl+C to stop)`);
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  setInterval(() => undefined, 1 << 30);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
