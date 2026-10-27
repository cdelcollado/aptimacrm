/**
 * Typed, validated runtime configuration. Read lazily so tests can set env before first use.
 * Secrets are only ever read here and never serialized into client components.
 */

export type StorageDriver = "local" | "s3";

export interface AppConfig {
  databaseUrl: string;
  storageDriver: StorageDriver;
  storageLocalDir: string;
  s3: {
    endpoint: string | undefined;
    region: string;
    bucket: string | undefined;
    accessKeyId: string | undefined;
    secretAccessKey: string | undefined;
  };
  inboundEmailSecret: string | undefined;
  inboundEmailAddress: string;
  orgTimezone: string;
  orgCurrency: "EUR";
  cookieSecure: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const env = process.env;

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new ConfigError("DATABASE_URL is required. See .env.example.");
  }

  const storageDriver = (env.STORAGE_DRIVER ?? "local") as StorageDriver;
  if (storageDriver !== "local" && storageDriver !== "s3") {
    throw new ConfigError(`STORAGE_DRIVER must be 'local' or 's3', got '${storageDriver}'.`);
  }

  const orgCurrency = env.ORG_CURRENCY ?? "EUR";
  if (orgCurrency !== "EUR") {
    throw new ConfigError("Only ORG_CURRENCY=EUR is supported in this release.");
  }

  cached = {
    databaseUrl,
    storageDriver,
    storageLocalDir: env.STORAGE_LOCAL_DIR ?? "./storage-data",
    s3: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION ?? "auto",
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    inboundEmailSecret: env.INBOUND_EMAIL_SECRET,
    inboundEmailAddress: env.INBOUND_EMAIL_ADDRESS ?? "capture@crm.example.com",
    orgTimezone: env.ORG_TIMEZONE ?? "Europe/Madrid",
    orgCurrency: "EUR",
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : env.NODE_ENV === "production",
  };
  return cached;
}

/** Test helper: forget the cached config after mutating process.env. */
export function resetConfigCache(): void {
  cached = undefined;
}
