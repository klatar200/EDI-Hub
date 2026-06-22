/**
 * Centralised, validated runtime configuration.
 *
 * Reads from the environment once at startup. Required values that are missing
 * cause a fast crash with a clear message — we never want the API to boot in a
 * half-configured state. (Sprint 3 will swap the hand-rolled validation for
 * `envalid` and add a richer health check; the contract here stays the same.)
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer, got: ${raw}`);
  }
  return parsed;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

export interface S3Config {
  bucket: string;
  region: string;
  /** Set for MinIO/LocalStack; empty for real AWS S3. */
  endpoint: string | undefined;
  /** true for MinIO (path-style); false for real AWS S3. */
  forcePathStyle: boolean;
}

export interface RetryConfig {
  /** Total attempts for an S3 write (1 = no retry). */
  maxAttempts: number;
  /** Base delay for exponential backoff, in milliseconds. */
  baseDelayMs: number;
}

export interface SftpWatchConfig {
  enabled: boolean;
  /** Folder watched for dropped EDI files (mirrors the test env drop folder). */
  watchDir: string;
  /** Successfully ingested files are moved here. */
  processedDir: string;
  /** Files that failed ingestion are moved here. */
  failedDir: string;
  /** How long a file must be quiescent before we treat the write as complete. */
  stabilityThresholdMs: number;
}

/** Phase 8 Sprint 2 — AS2 receive watcher. Structurally identical to SFTP
 *  because both end up handing the same generic drop-folder helper the same
 *  three folders; the only difference is the SourceChannel tag and the fact
 *  that the inbox is fed by the OpenAS2 daemon rather than an SFTP server. */
export interface As2WatchConfig {
  enabled: boolean;
  /** OpenAS2 inbox — daemon drops decrypted, signature-verified EDI here. */
  inboxDir: string;
  processedDir: string;
  failedDir: string;
  stabilityThresholdMs: number;
}

export interface NotifierConfig {
  /** disabled = no-op; preview = write trail to alert; live = real SES + Slack. */
  mode: 'disabled' | 'preview' | 'live';
  /** Verified SES sender. Required for live mode; ignored otherwise. */
  sesFrom: string;
  /** AWS region for SES. Defaults to the S3 region. */
  sesRegion: string;
  /** Optional global Slack incoming-webhook URL used when a partner contact
   *  has no slackWebhook configured. Empty disables the fallback. */
  globalSlackWebhook: string;
}

/** Phase 9 Sprint 2 — Clerk integration. When `secretKey` or `webhookSecret`
 *  are blank, the API runs in dev-fallback mode: the tenant preHandler pins
 *  every request to the pilot tenant (no JWT verification), and the webhook
 *  endpoint refuses all requests. Production MUST set both. */
export interface ClerkConfig {
  /** `sk_test_...` / `sk_live_...` from Clerk dashboard. Used to verify JWTs
   *  via @clerk/backend's authenticateRequest. */
  secretKey: string;
  /** `whsec_...` Svix signing secret from the Clerk webhook configuration. */
  webhookSecret: string;
  /** `pk_test_...` / `pk_live_...` — same publishable key the web app uses.
   *  Required by @clerk/backend to derive the JWKS issuer in some paths.
   *  Optional in tests; loadConfig populates it from VITE_CLERK_PUBLISHABLE_KEY. */
  publishableKey?: string;
  /** Comma-separated origins the Clerk SDK should accept as `azp` claim
   *  values. Empty / undefined → dev default of localhost:5173 + localhost:3000.
   *  Optional in tests. */
  authorizedParties?: string;
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  maxFileSizeBytes: number;
  s3: S3Config;
  retry: RetryConfig;
  sftp: SftpWatchConfig;
  /** Phase 8 Sprint 2 — AS2 receive channel (OpenAS2 inbox watcher). */
  as2: As2WatchConfig;
  /**
   * Trading-partner ISA sender/receiver IDs that represent "us" (the hub
   * operator). Used at parse time to tag each transaction `inbound` or
   * `outbound`. Pre-Phase 9 this is a single env-driven list; Phase 9 makes
   * it per-tenant.
   */
  ourIsaIds: string[];
  notifier: NotifierConfig;
  /** Phase 9 Sprint 2 — Clerk auth + webhook secrets. */
  clerk: ClerkConfig;
  /** Minutes to suppress duplicate alerts after one fires (Phase 7 Gate G). */
  alertSuppressionMinutes: number;
}

export function loadConfig(): AppConfig {
  // DATABASE_URL is consumed directly by Prisma; assert presence so a missing
  // DB config fails at boot rather than on first query.
  required('DATABASE_URL');

  const endpoint = process.env.S3_ENDPOINT?.trim();

  return {
    port: intEnv('PORT', 3000),
    nodeEnv: optional('NODE_ENV', 'development'),
    maxFileSizeBytes: intEnv('MAX_FILE_SIZE_BYTES', 25 * 1024 * 1024),
    s3: {
      bucket: required('S3_BUCKET'),
      region: optional('S3_REGION', 'us-east-1'),
      endpoint: endpoint && endpoint.length > 0 ? endpoint : undefined,
      forcePathStyle: boolEnv('S3_FORCE_PATH_STYLE', false),
    },
    retry: {
      maxAttempts: intEnv('S3_MAX_RETRIES', 3),
      baseDelayMs: intEnv('S3_RETRY_BASE_DELAY_MS', 200),
    },
    sftp: {
      enabled: boolEnv('SFTP_WATCH_ENABLED', false),
      watchDir: optional('SFTP_WATCH_DIR', './.sftp/incoming'),
      processedDir: optional('SFTP_PROCESSED_DIR', './.sftp/processed'),
      failedDir: optional('SFTP_FAILED_DIR', './.sftp/failed'),
      stabilityThresholdMs: intEnv('SFTP_STABILITY_MS', 500),
    },
    as2: {
      enabled: boolEnv('AS2_ENABLED', false),
      inboxDir: optional('AS2_INBOX_DIR', './.as2/inbox'),
      processedDir: optional('AS2_PROCESSED_DIR', './.as2/processed'),
      failedDir: optional('AS2_FAILED_DIR', './.as2/failed'),
      stabilityThresholdMs: intEnv('AS2_STABILITY_MS', 500),
    },
    ourIsaIds: optional('OUR_ISA_IDS', '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    notifier: {
      mode: (() => {
        const v = optional('NOTIFIER_MODE', 'preview').toLowerCase();
        return v === 'live' ? 'live' : v === 'disabled' ? 'disabled' : 'preview';
      })(),
      sesFrom: optional('SES_FROM', ''),
      sesRegion: optional('SES_REGION', optional('S3_REGION', 'us-east-1')),
      globalSlackWebhook: optional('GLOBAL_SLACK_WEBHOOK', ''),
    },
    clerk: {
      secretKey: optional('CLERK_SECRET_KEY', ''),
      // Reuse the same env name the web app uses so a single .env entry
      // feeds both — VITE_ prefix is harmless for the API.
      publishableKey: optional('VITE_CLERK_PUBLISHABLE_KEY', optional('CLERK_PUBLISHABLE_KEY', '')),
      webhookSecret: optional('CLERK_WEBHOOK_SECRET', ''),
      authorizedParties: optional('CLERK_AUTHORIZED_PARTIES', ''),
    },
    alertSuppressionMinutes: intEnv('ALERT_SUPPRESSION_MINUTES', 60),
  };
}
