###############################################################################
# Phase 10 Sprint 2 — Logical backup storage + scheduled pg_dump.
#
# Two layers of DB backup protection:
#   1. RDS automated snapshots (infra/rds.tf) — fast restore, same region.
#   2. Weekly logical `pg_dump --format=custom` to this bucket — cross-region
#      replicated, object-locked for 90 days (compliance mode). Survives
#      account compromise + region outage.
#
# Restore is documented in ops/RUNBOOKS.md; the convenience script lives in
# ops/scripts/restore-from-pgdump.sh.
###############################################################################

variable "backup_bucket_name" {
  type        = string
  description = "Globally unique name for the logical-backup bucket (e.g. edi-hub-backups-prod)."
}

variable "backup_replica_region" {
  type        = string
  description = "Destination region for cross-region replication."
  default     = "us-west-2"
}

variable "backup_replica_bucket_name" {
  type        = string
  description = "Bucket name in the destination region (must be globally unique)."
}

provider "aws" {
  alias  = "replica"
  region = var.backup_replica_region
}

# ─────────────────────────────────────────────────────────────
# Primary bucket (same region as RDS).
# Object lock REQUIRES the bucket to be created with lock enabled — you
# cannot enable it afterwards. Don't `terraform destroy` this bucket
# casually; locked objects can't be deleted before retention expires.
# ─────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "backups" {
  bucket              = var.backup_bucket_name
  object_lock_enabled = true

  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
    Purpose     = "logical-db-backups"
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Object lock — 90-day compliance retention.
# COMPLIANCE mode: nothing, not even the account root, can delete or
# shorten the lock until the retention expires. Belt + suspenders against
# accidental + malicious deletion.
resource "aws_s3_bucket_object_lock_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = 90
    }
  }
}

# Lifecycle: move to STANDARD_IA at 30 days, GLACIER at 90 days, expire
# (non-current versions) at 1 year. Current versions stay forever — the
# operator deletes them by lifting object lock + delete.
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "tiering-and-expiry"
    status = "Enabled"
    filter {}

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }
    transition {
      days          = 90
      storage_class = "GLACIER"
    }
    noncurrent_version_expiration {
      noncurrent_days = 365
    }
  }
}

# Reject any PUT that isn't SSE-encrypted; reject any non-TLS request.
resource "aws_s3_bucket_policy" "backups_security" {
  bucket = aws_s3_bucket.backups.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyUnencryptedPut"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.backups.arn}/*"
        Condition = {
          StringNotEquals = {
            "s3:x-amz-server-side-encryption" = "AES256"
          }
        }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.backups.arn,
          "${aws_s3_bucket.backups.arn}/*"
        ]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }
    ]
  })
}

# ─────────────────────────────────────────────────────────────
# Replica bucket in the other region.
# ─────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "backups_replica" {
  provider            = aws.replica
  bucket              = var.backup_replica_bucket_name
  object_lock_enabled = true

  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
    Purpose     = "logical-db-backups-replica"
  }
}

resource "aws_s3_bucket_versioning" "backups_replica" {
  provider = aws.replica
  bucket   = aws_s3_bucket.backups_replica.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups_replica" {
  provider = aws.replica
  bucket   = aws_s3_bucket.backups_replica.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "backups_replica" {
  provider                = aws.replica
  bucket                  = aws_s3_bucket.backups_replica.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_object_lock_configuration" "backups_replica" {
  provider = aws.replica
  bucket   = aws_s3_bucket.backups_replica.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = 90
    }
  }
}

# ─────────────────────────────────────────────────────────────
# Cross-region replication: primary → replica.
# ─────────────────────────────────────────────────────────────

resource "aws_iam_role" "backup_replication" {
  name = "edi-hub-backup-replication-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "backup_replication" {
  name = "edi-hub-backup-replication-${var.environment}"
  role = aws_iam_role.backup_replication.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket",
        ]
        Resource = aws_s3_bucket.backups.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging",
        ]
        Resource = "${aws_s3_bucket.backups.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags",
        ]
        Resource = "${aws_s3_bucket.backups_replica.arn}/*"
      },
    ]
  })
}

resource "aws_s3_bucket_replication_configuration" "backups" {
  # Replication requires versioning enabled on both sides; depend explicitly
  # so terraform applies in the right order.
  depends_on = [
    aws_s3_bucket_versioning.backups,
    aws_s3_bucket_versioning.backups_replica,
  ]
  role   = aws_iam_role.backup_replication.arn
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "replicate-all"
    status = "Enabled"

    filter {}
    delete_marker_replication { status = "Disabled" }

    destination {
      bucket        = aws_s3_bucket.backups_replica.arn
      storage_class = "STANDARD_IA"
    }
  }
}

output "backup_bucket_name" {
  value       = aws_s3_bucket.backups.id
  description = "Primary backup bucket — the pg_dump job writes here."
}

output "backup_replica_bucket_name" {
  value       = aws_s3_bucket.backups_replica.id
  description = "Cross-region replica — fallback target for restore."
}
