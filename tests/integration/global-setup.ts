import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { runMigrations } from "@/server/db/migrate";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
    storageDir: string;
  }
}

/** A throwaway PostgreSQL cluster per test run, with its own database. Nothing persists between runs. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

export default async function setup(project: TestProject) {
  const port = await freePort();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "aptima-pg-"));
  const password = randomBytes(12).toString("hex");
  const pgServer = new EmbeddedPostgres({ databaseDir: dataDir, user: "aptima", password, port, persistent: false, onLog: () => undefined, onError: () => undefined });
  await pgServer.initialise();
  await pgServer.start();

  const dbName = `aptima_test_${randomBytes(4).toString("hex")}`;
  await pgServer.createDatabase(dbName);
  const url = `postgres://aptima:${password}@127.0.0.1:${port}/${dbName}`;
  await runMigrations(url);

  const storageDir = await mkdtemp(path.join(os.tmpdir(), "aptima-storage-"));
  project.provide("dbUrl", url);
  project.provide("storageDir", storageDir);

  return async () => {
    const client = new pg.Client({ connectionString: url });
    await client.connect().then(() => client.end()).catch(() => undefined);
    await pgServer.stop().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  };
}
