import pg from "pg";
import { E2E } from "./config";

/** Direct database access for setup that the interface cannot do (expiring a session). Local stack only. */
export async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: E2E.databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
