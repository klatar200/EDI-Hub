/**
 * S3 storage layer.
 *
 * Wraps the AWS SDK so the rest of the app never touches S3 primitives
 * directly. The same code targets MinIO locally and real AWS S3 in
 * production — only env vars change (endpoint / path-style / credentials).
 *
 * "Raw file is sacred": uploads stream straight to object storage before any
 * parsing, and the bucket has versioning enabled so an overwrite never
 * destroys prior bytes.
 */
import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { S3Config } from '../config.js';

export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    // Credentials are read from the standard AWS_* env vars by the SDK.
  });
}

/**
 * Dev convenience: make sure the bucket exists and has versioning on.
 * On real AWS the bucket is provisioned by Terraform (see infra/), so this is
 * a no-op safety net — it tolerates an already-existing bucket.
 */
export async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  // Versioning is idempotent to enable.
  await client.send(
    new PutBucketVersioningCommand({
      Bucket: bucket,
      VersioningConfiguration: { Status: 'Enabled' },
    }),
  );
}

export interface UploadResult {
  key: string;
}

/**
 * Stream a body to S3 under `key`. Uses managed multipart upload so large
 * files are never fully buffered in memory.
 */
export async function uploadStream(params: {
  client: S3Client;
  bucket: string;
  key: string;
  body: Readable;
  contentType?: string;
  /** Default true — set false for MinIO / custom endpoints. */
  serverSideEncryption?: boolean;
}): Promise<UploadResult> {
  const upload = new Upload({
    client: params.client,
    params: {
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType ?? 'application/octet-stream',
      ...(params.serverSideEncryption !== false
        ? {
            // Phase 9 Sprint 5 — explicit SSE-S3 on every PUT (real AWS only).
            ServerSideEncryption: 'AES256' as const,
          }
        : {}),
    },
  });
  await upload.done();
  return { key: params.key };
}

/** Fetch an object's full bytes by key. Used for retrieval and smoke tests. */
export async function getObjectBuffer(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<Buffer> {
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * Build the canonical S3 key for a raw file. Date-partitioned for cheap
 * lifecycle/retention rules later, suffixed with the DB id so the object and
 * its database row are trivially correlated.
 */
export function buildRawFileKey(id: string, ingestedAt: Date = new Date()): string {
  const yyyy = ingestedAt.getUTCFullYear();
  const mm = String(ingestedAt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ingestedAt.getUTCDate()).padStart(2, '0');
  return `raw/${yyyy}/${mm}/${dd}/${id}.edi`;
}
