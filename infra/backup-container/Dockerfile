# Phase 10 Sprint 2.2 — Minimal pg_dump → S3 image.
#
# The scheduled ECS task runs this container weekly. It pulls the DB URL
# from Secrets Manager (resolved by the ECS task definition's `secrets`
# block), runs pg_dump --format=custom, uploads to S3 under a deterministic
# key, and emits a CloudWatch metric on success so the staleness alarm
# in infra/alarms.tf can fire when the job stops working.
#
# Pinned image versions because backups are a "no surprises" workload.
# `pg_dump` version must match (or exceed) the RDS server major version —
# Postgres 16 here.

FROM postgres:16-alpine

RUN apk add --no-cache aws-cli ca-certificates bash

COPY run-backup.sh /usr/local/bin/run-backup.sh
RUN chmod +x /usr/local/bin/run-backup.sh

# DATABASE_URL is injected via ECS `secrets` from Secrets Manager.
# BACKUP_BUCKET + BACKUP_PREFIX + AWS_REGION come from the task env.
# CW_NAMESPACE + CW_METRIC are optional overrides.
ENV CW_NAMESPACE="edi-hub" \
    CW_METRIC="BackupSuccess"

ENTRYPOINT ["/usr/local/bin/run-backup.sh"]
