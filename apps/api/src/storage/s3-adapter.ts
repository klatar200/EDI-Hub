/**
 * Desktop track D3 Sprint 1 — S3 storage adapter.
 *
 * Wraps the existing S3 helpers (`s3.ts`) so they conform to the
 * `StorageAdapter` interface. The helpers themselves stay untouched — they
 * still own bucket lifecycle setup (`createS3Client`, `ensureBucket`) which
 * is S3-specific and lives outside the data-path interface.
 *
 * This adapter is the default in production (`STORAGE_BACKEND=s3`). The
 * factory builds one per process; the resulting object is decorated onto
 * Fastify as `app.storage`.
 */
import type { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import type { StorageAdapter } from './interface.js';
import { buildRawFileKey, getObjectBuffer, uploadStream } from './s3.js';

export class S3StorageAdapter implements StorageAdapter {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly serverSideEncryption = true,
  ) {}

  async upload(key: string, body: Readable, contentType?: string): Promise<{ key: string }> {
    return uploadStream({
      client: this.client,
      bucket: this.bucket,
      key,
      body,
      contentType,
      serverSideEncryption: this.serverSideEncryption,
    });
  }

  async download(key: string): Promise<Buffer> {
    return getObjectBuffer(this.client, this.bucket, key);
  }

  buildKey(id: string, ingestedAt?: Date): string {
    return buildRawFileKey(id, ingestedAt);
  }
}
