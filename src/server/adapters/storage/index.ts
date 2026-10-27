import { getConfig } from "@/server/config";
import type { ObjectStorage } from "@/server/adapters/storage/types";
import { LocalStorage } from "@/server/adapters/storage/local";
import { S3Storage } from "@/server/adapters/storage/s3";

let instance: ObjectStorage | undefined;

/** Server-only singleton chosen by STORAGE_DRIVER. Never import this from a client component. */
export function getStorage(): ObjectStorage {
  if (instance) return instance;
  const cfg = getConfig();
  if (cfg.storageDriver === "s3") {
    if (!cfg.s3.bucket) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    instance = new S3Storage({
      bucket: cfg.s3.bucket,
      clientConfig: {
        endpoint: cfg.s3.endpoint,
        region: cfg.s3.region,
        forcePathStyle: true,
        credentials:
          cfg.s3.accessKeyId && cfg.s3.secretAccessKey
            ? { accessKeyId: cfg.s3.accessKeyId, secretAccessKey: cfg.s3.secretAccessKey }
            : undefined,
      },
    });
  } else {
    instance = new LocalStorage(cfg.storageLocalDir);
  }
  return instance;
}

export function setStorageForTests(storage: ObjectStorage | undefined): void {
  instance = storage;
}
