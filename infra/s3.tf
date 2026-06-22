###############################################################################
# Raw-file object storage (Phase 1).
#
# The hub stores every ingested EDI transmission verbatim before parsing.
# This bucket is: versioned (overwrites never destroy prior bytes), fully
# private (no public access), and encrypted at rest.
###############################################################################

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "environment" {
  type        = string
  description = "Deployment environment (dev | staging | prod)."
}

variable "bucket_name" {
  type        = string
  description = "Globally unique S3 bucket name for raw EDI files."
}

resource "aws_s3_bucket" "raw_files" {
  bucket = var.bucket_name
  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
    Purpose     = "raw-edi-files"
  }
}

resource "aws_s3_bucket_versioning" "raw_files" {
  bucket = aws_s3_bucket.raw_files.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "raw_files" {
  bucket = aws_s3_bucket.raw_files.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Phase 10 Sprint 3.3 — Lifecycle tiering for raw EDI files.
#
# Storage costs drop sharply as objects age; access patterns drop with
# them (the lifecycle UI almost never asks for the raw bytes of a
# year-old transaction). Transitions:
#   - 90 days  → STANDARD_IA   (cheaper storage, same retrieval latency)
#   - 365 days → GLACIER       (cold; restore is a manual operation)
# Object EXPIRY is intentionally NOT set here — the retention worker
# (apps/api/src/services/retention.ts) drives deletion in tandem with
# the DB row flipping to ARCHIVED, so the two stay in sync.
resource "aws_s3_bucket_lifecycle_configuration" "raw_files" {
  bucket = aws_s3_bucket.raw_files.id
  rule {
    id     = "tiering"
    status = "Enabled"
    filter {}
    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }
    transition {
      days          = 365
      storage_class = "GLACIER"
    }
  }
}

# Block every avenue of public access.
resource "aws_s3_bucket_public_access_block" "raw_files" {
  bucket                  = aws_s3_bucket.raw_files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Phase 9 Sprint 5 — Reject PutObject calls that don't ask for SSE-S3.
# The bucket's default-encryption rule already encrypts at rest; this policy
# is belt-and-suspenders: it makes "raw bytes written without an encryption
# header" a hard 403 instead of relying on the default. Also blocks plaintext
# (non-TLS) requests.
resource "aws_s3_bucket_policy" "raw_files_enforce_sse" {
  bucket = aws_s3_bucket.raw_files.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyUnencryptedPut"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.raw_files.arn}/*"
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
          aws_s3_bucket.raw_files.arn,
          "${aws_s3_bucket.raw_files.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

# Least-privilege policy for the ingestion service: object put/get on this
# bucket only. No bucket administration, no delete (raw file is sacred).
resource "aws_iam_policy" "ingestion" {
  name        = "edi-ingestion-${var.environment}"
  description = "Least-privilege S3 access for the EDI ingestion service."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WriteAndReadRawObjects"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.raw_files.arn,
          "${aws_s3_bucket.raw_files.arn}/*"
        ]
      }
    ]
  })
}

output "raw_files_bucket" {
  value = aws_s3_bucket.raw_files.id
}

output "ingestion_policy_arn" {
  value = aws_iam_policy.ingestion.arn
}
