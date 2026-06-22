# Phase 9 Sprint 4 — AWS Secrets Manager entries.
#
# The API loads these at boot via apps/api/src/services/secrets.ts when the
# SM_PREFIX env var is set (e.g. `edi/prod`). Each secret is stored
# unversioned with a placeholder; `terraform apply` creates the entries,
# but the real values are populated out-of-band (the operator pastes the
# Clerk dashboard secret into the AWS console once per environment) — we
# never check production secrets into Terraform state.
#
# Naming convention: `${var.environment_prefix}/${NAME}`, where NAME matches
# the env var the dev workflow uses (DATABASE_URL, CLERK_SECRET_KEY, etc.).
# The secrets loader appends NAME to the prefix, so deployment and dev share
# the same names — only the source changes.

variable "environment_prefix" {
  description = "Prefix for every secret in this environment, e.g. 'edi/prod' or 'edi/staging'."
  type        = string
  default     = "edi/prod"
}

# Phase 9 Sprint 5 — Project-owned KMS CMK that encrypts every secret in
# this file. Using a CMK (not the AWS-managed aws/secretsmanager key) means
# rotation, key-policy scoping, and audit trails are all under our control.
# Yearly rotation is enabled because AWS rotates the underlying material
# transparently; ciphertexts written under the old material still decrypt.
resource "aws_kms_key" "secrets" {
  description             = "EDI Hub — encrypts Secrets Manager entries under ${var.environment_prefix}."
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
    Purpose     = "secrets-manager"
  }
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/edi-hub-secrets-${var.environment}"
  target_key_id = aws_kms_key.secrets.key_id
}

# DB connection string. SSL params are baked in here, not in the API config.
resource "aws_secretsmanager_secret" "database_url" {
  name        = "${var.environment_prefix}/DATABASE_URL"
  description = "Postgres connection string (with sslmode=require) used by Prisma."
  kms_key_id  = aws_kms_key.secrets.id
}

# Clerk backend SDK secret. Used to verify org-aware JWTs.
resource "aws_secretsmanager_secret" "clerk_secret_key" {
  name        = "${var.environment_prefix}/CLERK_SECRET_KEY"
  description = "Clerk sk_live_... secret used by @clerk/backend.authenticateRequest."
  kms_key_id  = aws_kms_key.secrets.id
}

# Clerk webhook signing secret. Used by Svix on the /webhooks/clerk route
# to verify Clerk-originated requests.
resource "aws_secretsmanager_secret" "clerk_webhook_secret" {
  name        = "${var.environment_prefix}/CLERK_WEBHOOK_SECRET"
  description = "Svix signing secret (whsec_...) for the Clerk webhook endpoint."
  kms_key_id  = aws_kms_key.secrets.id
}

# Optional Slack incoming-webhook URL used by the notifier when a partner
# contact has no per-partner webhook configured.
resource "aws_secretsmanager_secret" "global_slack_webhook" {
  name        = "${var.environment_prefix}/GLOBAL_SLACK_WEBHOOK"
  description = "Fallback Slack incoming-webhook URL used by the alert notifier."
  kms_key_id  = aws_kms_key.secrets.id
}

# Outputs so the ECS task definition can reference the ARNs in its
# `secrets` block (recommended) instead of pre-fetching values at deploy
# time. Using ECS task secrets means the SDK never sees the value; we use
# the Secrets Manager source only for boot-time secrets the SDK actually
# needs to fetch (e.g. when running outside ECS).
output "secret_arns" {
  value = {
    database_url         = aws_secretsmanager_secret.database_url.arn
    clerk_secret_key     = aws_secretsmanager_secret.clerk_secret_key.arn
    clerk_webhook_secret = aws_secretsmanager_secret.clerk_webhook_secret.arn
    global_slack_webhook = aws_secretsmanager_secret.global_slack_webhook.arn
  }
  description = "Secret ARNs for use in ECS task definitions or external references."
}

output "secrets_kms_key_arn" {
  value       = aws_kms_key.secrets.arn
  description = "ARN of the CMK encrypting every secret here — grant kms:Decrypt to the ECS task role."
}
