import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getConfig } from "@/server/config";
import * as schema from "@/server/db/schema";

export type Db = NodePgDatabase<typeof schema>;

type Holder = { pool?: pg.Pool; db?: Db; url?: string };
const globalForDb = globalThis as unknown as { __aptimaDb?: Holder };
const holder: Holder = globalForDb.__aptimaDb ?? (globalForDb.__aptimaDb = {});

/** Transaction handle passed to domain functions that write several rows atomically. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

/**
 * Single pool per process. The pool is recreated if DATABASE_URL changes, which lets the
 * integration tests point at an isolated database without restarting the process.
 */
export function getDb(): Db {
  const url = getConfig().databaseUrl;
  if (holder.db && holder.url === url) return holder.db;
  holder.pool?.end().catch(() => undefined);
  holder.pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
  });
  holder.db = drizzle(holder.pool, { schema });
  holder.url = url;
  return holder.db;
}

export async function closeDb(): Promise<void> {
  await holder.pool?.end();
  holder.pool = undefined;
  holder.db = undefined;
  holder.url = undefined;
}

/**
 * Run `fn` inside a transaction. Domain code uses this for every multi-row change so a
 * failure rolls back the whole unit (stage moves, imports, merges).
 */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(fn);
}

export { schema };
