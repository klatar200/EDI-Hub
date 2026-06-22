/**
 * Phase 9 Sprint 4 — Secrets loader.
 *
 * Production reads sensitive config (DB URL, Clerk secrets, S3 creds via
 * IAM role normally, but explicit SES / Slack secrets too) from AWS Secrets
 * Manager. Dev keeps reading from `.env`. We accomplish this with a small
 * pluggable interface:
 *
 *   SecretSource.get(name) -> Promise<string | undefined>
 *
 * - `EnvSecretSource`           — reads from `process.env` (default; dev).
 * - `SecretsManagerSecretSource` — reads from AWS Secrets Manager under a
 *                                   configurable prefix.
 *
 * `applySecretsFromManager(config)` is called once at startup AFTER
 * `loadConfig()`. It only does work when `SM_PREFIX` is set (i.e. we're
 * running in an environment where Secrets Manager is provisioned). Dev
 * boots don't even import `@aws-sdk/client-secrets-manager`.
 *
 * Why overlay instead of replacing `loadConfig`: keeping the sync env path
 * as the default means every test fixture, script, and dev-loop keeps
 * working unchanged. Production calls one extra async step at boot.
 */
import type { AppConfig } from '../config.js';

/** Abstract source of secret values. Implementations must be safe to call
 *  for unknown names — return `undefined` rather than throwing. */
export interface SecretSource {
  /** Returns the raw secret string, or undefined if not configured. */
  get(name: string): Promise<string | undefined>;
}

/** Default: read from process.env. Useful for tests + dev. */
export class EnvSecretSource implements SecretSource {
  async get(name: string): Promise<string | undefined> {
    const v = process.env[name];
    return v && v.trim().length > 0 ? v : undefined;
  }
}

/**
 * AWS Secrets Manager-backed source. Pull secrets stored under a prefix
 * (e.g. `edi/prod/DATABASE_URL`) by appending the secret name to the
 * prefix. Lazy-loads `@aws-sdk/client-secrets-manager` so dev boots never
 * incur the dependency.
 *
 * The cached secret-value map is per-instance: the manager class instance
 * lives for the life of the process and caches reads. AWS Secrets Manager
 * itself is not designed for read-on-every-request traffic; we read once
 * at boot.
 */
export class SecretsManagerSecretSource implements SecretSource {
  private cache = new Map<string, string | undefined>();
  private client: { send: (cmd: unknown) => Promise<unknown> } | null = null;
  /** Pulled lazily so the @aws-sdk import only happens when this class is
   *  actually constructed. */
  private GetSecretValueCommand: (new (args: { SecretId: string }) => unknown) | null = null;

  constructor(
    private readonly prefix: string,
    private readonly region: string,
  ) {}

  private async ensureClient(): Promise<void> {
    if (this.client) return;
    // Dynamic import keeps the SDK out of dev bundles AND out of the dev
    // dependency tree — the package is only installed in production images
    // where SM_PREFIX is set. TS would otherwise error on the missing
    // module declaration even though this branch never runs in dev.
    // @ts-ignore — optional production-only dep, install only in prod image
    const mod = await import('@aws-sdk/client-secrets-manager');
    this.client = new mod.SecretsManagerClient({ region: this.region });
    this.GetSecretValueCommand = mod.GetSecretValueCommand;
  }

  async get(name: string): Promise<string | undefined> {
    if (this.cache.has(name)) return this.cache.get(name);
    await this.ensureClient();
    const SecretId = `${this.prefix}/${name}`;
    try {
      const cmd = new (this.GetSecretValueCommand as new (args: { SecretId: string }) => unknown)({
        SecretId,
      });
      const result = (await this.client!.send(cmd)) as { SecretString?: string };
      const value = result.SecretString && result.SecretString.length > 0
        ? result.SecretString
        : undefined;
      this.cache.set(name, value);
      return value;
    } catch (err) {
      // ResourceNotFoundException → secret not configured at all. Treat as
      // undefined so the env fallback can still kick in. Anything else is
      // a real config error — rethrow.
      const msg = err instanceof Error ? err.message : String(err);
      if (/ResourceNotFoundException|not found/i.test(msg)) {
        this.cache.set(name, undefined);
        return undefined;
      }
      throw err;
    }
  }
}

/**
 * Decide which secret source to use given the environment. Exported for
 * tests so they can swap in a fake source.
 */
export function defaultSecretSource(): SecretSource {
  const prefix = process.env.SM_PREFIX?.trim();
  if (!prefix) return new EnvSecretSource();
  const region = process.env.SM_REGION?.trim()
    || process.env.AWS_REGION?.trim()
    || process.env.S3_REGION?.trim()
    || 'us-east-1';
  return new SecretsManagerSecretSource(prefix, region);
}

/**
 * Overlay secret values onto an existing AppConfig. Mutates the config in
 * place and returns it for chaining. If `source` doesn't have a particular
 * secret, the existing value (from env via loadConfig) is kept.
 *
 * Currently overlays the highly sensitive fields:
 *   - DATABASE_URL          — re-exported to process.env so Prisma picks it up
 *   - CLERK_SECRET_KEY
 *   - CLERK_WEBHOOK_SECRET
 *   - GLOBAL_SLACK_WEBHOOK
 *
 * S3 creds intentionally come from the EC2/ECS IAM role in production, not
 * Secrets Manager — that's the SDK's standard credential chain.
 */
export async function applySecretsFromManager(
  config: AppConfig,
  source: SecretSource = defaultSecretSource(),
): Promise<AppConfig> {
  const dbUrl = await source.get('DATABASE_URL');
  if (dbUrl) {
    // Prisma reads DATABASE_URL directly from process.env at client init,
    // so we need to mirror the overlay there too.
    process.env.DATABASE_URL = dbUrl;
  }
  const clerkSecret = await source.get('CLERK_SECRET_KEY');
  if (clerkSecret) config.clerk.secretKey = clerkSecret;
  const clerkWebhook = await source.get('CLERK_WEBHOOK_SECRET');
  if (clerkWebhook) config.clerk.webhookSecret = clerkWebhook;
  const slack = await source.get('GLOBAL_SLACK_WEBHOOK');
  if (slack) config.notifier.globalSlackWebhook = slack;

  return config;
}
