#!/usr/bin/env bash
# Phase 10 Sprint 2.2 — pg_dump → S3 with CloudWatch heartbeat.
#
# Required env:
#   DATABASE_URL    — postgres connection string (with sslmode=require)
#   BACKUP_BUCKET   — destination S3 bucket name (no s3:// prefix)
#   BACKUP_PREFIX   — key prefix inside the bucket, e.g. "edi-hub"
#   AWS_REGION      — for the put-metric-data call
#
# Optional env:
#   CW_NAMESPACE    — CloudWatch namespace (default: edi-hub)
#   CW_METRIC       — CloudWatch metric name (default: BackupSuccess)
#
# Exit codes:
#   0 — dump + upload succeeded, heartbeat metric emitted (value=1)
#   1 — pg_dump failed
#   2 — S3 upload failed
#   3 — CloudWatch heartbeat failed (backup itself succeeded)

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
: "${BACKUP_PREFIX:?BACKUP_PREFIX is required}"
: "${AWS_REGION:?AWS_REGION is required}"

CW_NAMESPACE="${CW_NAMESPACE:-edi-hub}"
CW_METRIC="${CW_METRIC:-BackupSuccess}"

# Deterministic per-week key. ISO week number means re-running on the
# same Sunday overwrites instead of accumulating duplicates. Object lock
# keeps the previous version readable for 90 days regardless.
WEEK="$(date -u +%G-W%V)"
DUMP_FILE="/tmp/edi-hub-${WEEK}.dump"
S3_KEY="${BACKUP_PREFIX}/${WEEK}/db.dump"

echo "[backup] starting pg_dump for week ${WEEK}"
if ! pg_dump --format=custom --no-owner --no-privileges \
    --file="${DUMP_FILE}" \
    "${DATABASE_URL}"; then
  echo "[backup] pg_dump failed" >&2
  exit 1
fi

DUMP_BYTES="$(stat -c %s "${DUMP_FILE}")"
echo "[backup] pg_dump produced ${DUMP_BYTES} bytes; uploading to s3://${BACKUP_BUCKET}/${S3_KEY}"

if ! aws s3 cp \
    --region "${AWS_REGION}" \
    --sse AES256 \
    "${DUMP_FILE}" \
    "s3://${BACKUP_BUCKET}/${S3_KEY}"; then
  echo "[backup] S3 upload failed" >&2
  exit 2
fi

echo "[backup] upload OK; emitting CloudWatch heartbeat"
if ! aws cloudwatch put-metric-data \
    --region "${AWS_REGION}" \
    --namespace "${CW_NAMESPACE}" \
    --metric-name "${CW_METRIC}" \
    --value 1 \
    --unit Count \
    --dimensions Environment="${ENVIRONMENT:-prod}"; then
  echo "[backup] heartbeat failed — backup itself succeeded but the stale-alarm will eventually fire" >&2
  exit 3
fi

# Clean up the local dump so the container exits without consuming task space.
rm -f "${DUMP_FILE}"
echo "[backup] done (size=${DUMP_BYTES}, key=${S3_KEY})"
