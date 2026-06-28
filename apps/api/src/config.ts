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

/** Desktop track D3 Sprint 1 - which backend the storage adapter targets.
 *  `'s3'` is the SaaS default; `'local'` is the desktop installer + local dev. */
export type StorageBackend = 's3' | 'local';

export interface StorageConfig {
  backend: StorageBackend;
  /** Filesystem root the local adapter writes under (`<dataDir>/raw/<key>`).
   *  Ignored when `backend === 's3'`. Defaults to `<HOME>/.edi-hub` per the
   *  plan. */
  localDataDir: string;
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

/** Desktop track D4 Sprint 1 — CORS allowlist for cross-origin requests
 *  from the renderer to the API. SaaS / pure-web dev leaves this empty: the
 *  Vite proxy keeps requests same-origin and no CORS handling is registered.
 *  The desktop installer left this set in D4 Sprint 1 (renderer on :5173,
 *  API on :3100). Sprint 2 collapses both onto :3000 — same-origin — so the
 *  desktop env no longer needs CORS by default. Still useful for an
 *  optional dev-with-Vite-on-5173 hot-reload override. */
export interface CorsConfig {
  /** Empty = CORS plugin not registered (closed by default). */
  allowedOrigins: string[];
}

/** Desktop track D4 Sprint 2 — static-file serving for the React build.
 *  When set, @fastify/static is registered at `/` and serves `index.html`
 *  for any path that doesn't match a route or file (SPA fallback). LAN
 *  customers hit `http://<server-ip>:3000/` and get the React app from the
 *  same process that serves `/api/*`. Empty = SaaS / pure-web mode, where
 *  CloudFront (or Vite in dev) serves the static assets. */
export interface WebStaticConfig {
  /** Absolute path to the built React app (apps/web/dist). Empty disables
   *  static serving entirely. */
  dir: string;
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  maxFileSizeBytes: number;
  s3: S3Config;
  /** Desktop track D3 Sprint 1 - storage adapter selection. The SaaS build
   *  keeps the default ('s3'); the desktop installer flips it via env. */
  storage: StorageConfig;
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
  /** Desktop track D4 Sprint 1 — CORS allowlist. Empty = plugin not loaded. */
  cors: CorsConfig;
  /** Desktop track D4 Sprint 2 — static-file serving for the React build. */
  webStatic: WebStaticConfig;
  /** Minutes to suppress duplicate alerts after one fires (Phase 7 Gate G). */
  alertSuppressionMinutes: number;
}

export function loadConfig(): AppConfig {
  // DATABASE_URL is consumed directly by Prisma; assert presence so a missing
  // DB config fails at boot rather than on first query.
  required('DATABASE_URL');

  const endpoint = process.env.S3_ENDPOINT?.trim();

  const storageBackend: StorageBackend = (() => {
    const raw = optional('STORAGE_BACKEND', 's3').toLowerCase().trim();
    if (raw === 'local') return 'local';
    if (raw === '' || raw === 's3') return 's3';
    throw new Error(`Unsupported STORAGE_BACKEND='${raw}'. Allowed: 's3' (default) or 'local'.`);
  })();

  const nodeEnv = optional('NODE_ENV', 'development');

  const config: AppConfig = {
    port: intEnv('PORT', 3000),
    nodeEnv,
    maxFileSizeBytes: intEnv('MAX_FILE_SIZE_BYTES', 25 * 1024 * 1024),
    s3: {
      bucket: storageBackend === 's3' ? required('S3_BUCKET') : optional('S3_BUCKET', ''),
      region: optional('S3_REGION', 'us-east-1'),
      endpoint: endpoint && endpoint.length > 0 ? endpoint : undefined,
      forcePathStyle: boolEnv('S3_FORCE_PATH_STYLE', false),
    },
    storage: {
      backend: storageBackend,
      // Default to <HOME>/.edi-hub per DESKTOP_SPRINT_PLAN.md D3 Sprint 1.
      // Resolved at config load so the path is captured once and tests can
      // override via env without touching HOME globally.
      localDataDir: optional(
        'LOCAL_DATA_DIR',
        (process.env.HOME ?? process.env.USERPROFILE ?? process.cwd()) + '/.edi-hub',
      ),
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
    cors: {
      // Comma-separated list. Empty (default) = CORS plugin not registered,
      // i.e. same-origin only. The desktop main process sets this only when
      // it wants the renderer running cross-origin (e.g. an opt-in
      // Vite-on-5173 hot-reload override). Default LAN-server config
      // serves both renderer + API from one origin, no CORS needed.
      allowedOrigins: optional('CORS_ALLOWED_ORIGINS', '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    },
    webStatic: {
      // Absolute path to apps/web/dist. The desktop main process sets this
      // so the API serves the React build at `/`. Empty in cloud /
      // pure-web dev — that path is fronted by CloudFront / Vite.
      dir: optional('WEB_STATIC_DIR', ''),
    },
  };

  return config;
}

/** W1.1 — refuse production boot without Clerk. Call after `loadConfig` and
 *  `applySecretsFromManager` so Secrets Manager overlays are included.
 *  Applies to SaaS and desktop hub — production always requires Clerk. */
export function assertProductionAuthConfig(config: AppConfig): void {
  if (config.nodeEnv !== 'production') return;

  const missing: string[] = [];
  if (!config.clerk.secretKey.trim()) missing.push('CLERK_SECRET_KEY');
  if (!config.clerk.webhookSecret.trim()) missing.push('CLERK_WEBHOOK_SECRET');
  if (!config.clerk.publishableKey?.trim()) {
    missing.push('VITE_CLERK_PUBLISHABLE_KEY or CLERK_PUBLISHABLE_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `Production boot refused: missing Clerk configuration: ${missing.join(', ')}. ` +
        'Set all Clerk secrets (via env or Secrets Manager) before NODE_ENV=production.',
    );
  }
}

/** One-line auth mode for startup logs. */
export function resolveAuthMode(config: AppConfig): 'clerk' | 'dev-fallback' {
  return config.clerk.secretKey.trim() ? 'clerk' : 'dev-fallback';
}
