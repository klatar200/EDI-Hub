# Pre-Production TODO

> Operator checklist of wall-clock / credentialed work that has to happen
> before the first paying external customer can use the hub. Code is in
> the repo and CI is green — these are the steps that can't be automated
> by the agent. Check off and date each line as it's done.

## Infrastructure apply (per environment)

These run from `infra/` with the right AWS creds + tfvars. Apply in
order, smoke-test between major blocks.

- [ ] **Phase 9 Sprint 5 — Networking + storage baseline**
  - [ ] `terraform apply -target=aws_s3_bucket.raw_files`
  - [ ] `terraform apply -target=aws_kms_key.secrets`
  - [ ] Provide `env/<env>.tfvars` with `vpc_id`, `public_subnet_ids`, `db_subnet_ids`, `route53_zone_id`, `public_domain`, `bucket_name`, `db_master_username`. `db_master_password` via `TF_VAR_db_master_password`.
  - [ ] `terraform apply -var-file=env/<env>.tfvars` (RDS, ALB, ACM, Secrets entries).
- [ ] **Phase 9 Sprint 4 — Populate Secrets Manager values**
  - [ ] `DATABASE_URL` (with `sslmode=require`).
  - [ ] `CLERK_SECRET_KEY` (`sk_live_...`).
  - [ ] `CLERK_WEBHOOK_SECRET` (`whsec_...` from Clerk dashboard webhook config).
  - [ ] `GLOBAL_SLACK_WEBHOOK` (optional fallback notifier URL).
- [ ] **Phase 9 Sprint 2 — Clerk wiring** (see `CLERK_SETUP.md` for the full walkthrough).
- [ ] **Phase 10 Sprint 1 — CloudWatch log group**
  - [ ] `terraform apply` picks up `infra/logs.tf`.
  - [ ] ECS task definition's `awslogs-group` points at the output `api_log_group_name`.
- [ ] **Phase 10 Sprint 3 — Retention worker scheduled task**
  - [ ] Add ECS scheduled task running `npm run retention --workspace=apps/api` (or build a dedicated container that runs `tsx src/scripts/run-retention.ts`).
  - [ ] EventBridge schedule: daily 03:00 UTC. Reuse the backup-task IAM pattern (`infra/backup-task.tf`) — needs DB + S3 + Secrets Manager access plus CloudWatch logs.
  - [ ] Alarm: `RetentionRunSuccess` CloudWatch metric in `infra/alarms.tf`, fires if missed for 48 h.
- [ ] **Phase 10 Sprint 2 — Backups**
  - [ ] Build + push the backup container: `docker build -t edi-hub-backup:<tag> infra/backup-container` then `docker push <ECR-URI>:<tag>`.
  - [ ] Add to `env/<env>.tfvars`: `backup_bucket_name`, `backup_replica_bucket_name`, `backup_image`, `backup_subnet_ids`, `backup_cluster_arn`.
  - [ ] `terraform apply` — provisions backup bucket, replica, scheduled task, alarm, SNS topic.
  - [ ] Wire SNS → Slack per `ops/RUNBOOKS.md#setting-up-sns--slack`.

## Operational drills (recurring)

- [ ] **First restore drill** — `ops/RUNBOOKS.md#drilling-the-restore`. Append to `ops/RESTORE_LOG.md`. Repeat quarterly.
- [ ] **Synthetic alarm test** — publish a test message to `oncall_sns_topic_arn` and confirm it lands in Slack.

## Pre-launch verification

- [ ] **Smoke test over HTTPS** — per `infra/README.md`'s "Verifying the security posture" section (HTTP→HTTPS redirect, HSTS header, S3 PUT-without-SSE rejected, Postgres rejects non-TLS).
- [ ] **Security checklist sign-off** — every item in `SECURITY_CHECKLIST.md` confirmed; independent reviewer second-pass recommended.
- [ ] **Load test baseline** — Phase 10 Sprint 5. Install k6, mint a load-test JWT in staging Clerk, run `ops/load/k6/read.js` + `ops/load/k6/ingest.js` per `ops/load/README.md`. Two consecutive runs within 10% on every Gate-E threshold; append rows to `ops/load/baseline.md`.
- [ ] **Runbook walk-through** — cold-read every section in `ops/RUNBOOKS.md` against a paused staging env. For each failure mode, walk the symptoms → first checks → mitigation steps and confirm the documented commands actually work. Fix any gap (commands that don't exist, fields that have renamed, AWS CLI options that changed) before signing off Phase 10.
- [ ] **Escalation paths** — read `ops/SUPPORT.md`. Once a second person joins the on-call rotation, replace "the author" placeholders with named owners.
- [ ] **Synthetic incident drill** — pick one runbook section per quarter, run a contrived failure in staging, and walk the runbook cold. Log outcome in a new `ops/INCIDENT_LOG.md` (create on first use).

## Phase 10 exit checklist (M5 — Production-ready)

All five must be ✅ to declare Phase 10 done.

- [ ] **Observability** — `/internal/metrics` scrapable from staging; CloudWatch Logs queries return tenant-filtered request lines.
- [ ] **Backups proven** — at least one entry in `ops/RESTORE_LOG.md` from a real restore drill.
- [ ] **Retention running** — retention scheduled task deployed; one `retention.run` audit row per tenant per day.
- [ ] **Rate limit live** — 429 + `Retry-After` confirmed in staging; one synthetic `rate.exceeded` audit row recorded.
- [ ] **Runbooks usable** — cold-read walk-through complete; `ops/RUNBOOKS.md` updated with anything found missing.

After all five: tag a release `m5-production-ready` and update
`BUILD_PLAN.md` to mark M5 reached.

## Open items added by future sprints

> Append below as new sprints surface deploy-time work. Don't delete
> completed items — strike-through and date them so the audit trail
> survives.
