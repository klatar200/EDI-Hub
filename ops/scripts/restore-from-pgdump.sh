#!/usr/bin/env bash
# Phase 10 Sprint 2.5 — Restore a logical backup from S3 into a target DB.
#
# Usage:
#   ./ops/scripts/restore-from-pgdump.sh \
#     --bucket edi-hub-backups-prod \
#     --key    edi-hub/2026-W26/db.dump \
#     --target "postgres://user:pwd@host:5432/edi_hub?sslmode=require"
#
# Requirements (all on PATH):
#   - aws cli
#   - pg_restore (matching the source server's major version; ≥16 for v1)
#
# What it does:
#   1. Verifies the target DB is reachable + empty (refuses to overwrite).
#   2. Downloads the dump to /tmp.
#   3. Runs pg_restore --clean --if-exists --no-owner --no-privileges.
#   4. Prints a row-count summary so the operator can compare against
#      the source snapshot before cutting traffic over.
#
# Exit codes:
#   0   success
#   1   bad args
#   2   target DB not reachable
#   3   target DB is non-empty (safety stop)
#   4   download failed
#   5   restore failed

set -euo pipefail

BUCKET=""
KEY=""
TARGET=""
ALLOW_NON_EMPTY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bucket)        BUCKET="$2"; shift 2;;
    --key)           KEY="$2"; shift 2;;
    --target)        TARGET="$2"; shift 2;;
    --allow-non-empty) ALLOW_NON_EMPTY=true; shift;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

if [[ -z "${BUCKET}" || -z "${KEY}" || -z "${TARGET}" ]]; then
  echo "usage: $0 --bucket <name> --key <s3-key> --target <postgres URL>" >&2
  exit 1
fi

echo "[restore] verifying target DB is reachable"
if ! psql "${TARGET}" -c 'SELECT 1' > /dev/null 2>&1; then
  echo "[restore] cannot connect to target DB" >&2
  exit 2
fi

# Safety: refuse to restore over a populated DB unless explicitly allowed.
# Counts user tables in the `public` schema (Prisma's default).
TABLE_COUNT="$(psql "${TARGET}" -At -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"

if [[ "${TABLE_COUNT}" -gt 0 && "${ALLOW_NON_EMPTY}" != "true" ]]; then
  echo "[restore] target DB has ${TABLE_COUNT} tables; refusing to overwrite." >&2
  echo "[restore] re-run with --allow-non-empty if you really mean it (production cutover only)." >&2
  exit 3
fi

LOCAL="/tmp/edi-hub-restore-$$.dump"
trap 'rm -f "${LOCAL}"' EXIT

echo "[restore] downloading s3://${BUCKET}/${KEY} -> ${LOCAL}"
if ! aws s3 cp "s3://${BUCKET}/${KEY}" "${LOCAL}"; then
  echo "[restore] download failed" >&2
  exit 4
fi

DUMP_BYTES="$(stat -c %s "${LOCAL}" 2>/dev/null || stat -f %z "${LOCAL}")"
echo "[restore] dump downloaded (${DUMP_BYTES} bytes); restoring"

# --clean + --if-exists: drop pre-existing objects before recreating, so a
# partial-restore re-run is idempotent. --no-owner + --no-privileges:
# strip OWNER TO and GRANT lines from the dump so the new DB user owns
# everything without needing the original user's role to exist.
if ! pg_restore \
    --dbname="${TARGET}" \
    --clean --if-exists \
    --no-owner --no-privileges \
    --exit-on-error \
    "${LOCAL}"; then
  echo "[restore] pg_restore failed" >&2
  exit 5
fi

echo "[restore] done; row counts per table:"
psql "${TARGET}" -c "
  SELECT relname AS table, n_live_tup AS row_count
    FROM pg_stat_user_tables
   ORDER BY relname;
"

echo "[restore] next steps:"
echo "  1. Apply pending migrations:  npm run db:migrate:deploy --workspace=packages/db"
echo "  2. Walk smoke checklist:      ops/RUNBOOKS.md#post-restore-smoke-checklist"
echo "  3. Cut over via Secrets Manager + ECS update-service."
