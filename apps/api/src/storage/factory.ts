/**
 * Desktop track D3 Sprint 1 — storage adapter factory.
 *
 * Picks the active backend from `config.storage.backend` and constructs the
 * matching adapter. The factory is the only place that knows about both
 * adapters; everything downstream sees a `StorageAdapter`.
 *
 * For S3 mode an `S3Client` is required (the SaaS build already creates one
 * during bootstrap). For local mode the S3 client is irrelevant — pass
 * `undefined`.
 */
import type { S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from '../config.js';
import type { StorageAdapter } from './interface.js';
import { S3StorageAdapter } from './s3-adapter.js';
import { LocalStorageAdapter } from './local-adapter.js';

export function createStorageAdapter(
  config: AppConfig,
  s3Client?: S3Client,
): StorageAdapter {
  switch (config.storage.backend) {
    case 's3': {
      if (!s3Client) {
        throw new Error(
          "STORAGE_BACKEND='s3' requires an S3Client to be passed to the factory. " +
            "Construct one via createS3Client(config.s3) at boot.",
        );
      }
      return new S3StorageAdapter(
        s3Client,
        config.s3.bucket,
        config.s3.serverSideEncryption ?? !config.s3.endpoint,
      );
    }
    case 'local':
      return new LocalStorageAdapter({ dataDir: config.storage.localDataDir });
    default: {
      // Exhaustive narrowing — TS catches a new backend at compile time.
      const _exhaustive: never = config.storage.backend;
      throw new Error(`Unhandled STORAGE_BACKEND: ${String(_exhaustive)}`);
    }
  }
}
