import { inject, beforeEach, afterAll } from "vitest";
import { resetConfigCache } from "@/server/config";
import { closeDb } from "@/server/db/client";
import { resetDb } from "../../tests/helpers/db";

/** Per-file setup: point the app at this run's database and storage, and start each test from empty tables. */
process.env.DATABASE_URL = inject("dbUrl");
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_DIR = inject("storageDir");
process.env.INBOUND_EMAIL_SECRET = "test-inbound-secret-0123456789abcdef";
process.env.INBOUND_EMAIL_ADDRESS = "capture@crm.example.com";
process.env.ORG_TIMEZONE = "Europe/Madrid";
resetConfigCache();

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeDb();
});
