# EDI Data Hub — Operational Runbooks

> Written in Phase 10. Each section is a self-contained playbook for one
> failure mode. Read top-down: symptom → first checks → mitigation →
> rollback → escalation.
>
> If you're following a runbook in anger, **don't improvise — finish the
> documented steps first, then write up what was missing.** PRs to this
> file are encouraged after every incident.

## Index

| Section | Use when |
|---|---|
| [Restoring the database](#restoring-the-database) | The primary DB is lost / corrupted / needs cloning to a fresh env. |
| [Backup is stale](#backup-stale) | `edi-hub-backup-stale-*` alarm fired. |
| [Setting up SNS → Slack](#setting-up-sns--slack) | First-time setup of the on-call notification path. |
| [Performance regression](#performance-regression) | Latency / error-rate alarm fires; load test fails Gate E thresholds. |
| [Capacity callouts](#capacity-callouts) | An exhaustible resource (DB pool, S3, rate-limit) is the suspected bottleneck. |
| [DB unreachable](#db-unreachable) | API returns `503 DB_UNAVAILABLE` on writes; `/readiness` 503 with `db: error`. |
| [S3 unreachable](#s3-unreachable) | Ingest fails before parsing; `/readiness` 503 with `s3: error`. |
| [Channel queue backed up](#channel-queue-backed-up) | SFTP / AS2 drop folder is filling; ingestion lag rising. |
| [Clerk webhook drift](#clerk-webhook-drift) | Sign-in succeeds in Clerk but the hub returns `TENANT_NOT_PROVISIONED` / `USER_NOT_PROVISIONED`. |
| [Tenant deletion request](#tenant-deletion-request) | A customer asks for their data to be removed (or a staff support ticket comes in). |
| [Cross-tenant data leak (nuclear)](#cross-tenant-data-leak-nuclear) | Evidence — even circumstantial — that one tenant saw another's data. |
| [Audit row missing](#audit-row-missing) | A write the user clearly performed has no matching `audit_events` row. |

## Alert routing

Every CloudWatch alarm and Phase 7 alert maps to one section here. Use
this when you're paged at 2 AM and want one click to the playbook.

| Signal | Where it fires | Runbook section |
|---|---|---|
| `edi-hub-backup-stale-<env>` | CloudWatch | [Backup is stale](#backup-stale) |
| `/readiness` 503 — `db: error` | ALB target group, CloudWatch | [DB unreachable](#db-unreachable) |
| `/readiness` 503 — `s3: error` | ALB target group, CloudWatch | [S3 unreachable](#s3-unreachable) |
| `/internal/metrics` — `ingestion_channel_up{channel="sftp"} == 0` | Prometheus / Grafana | [Channel queue backed up](#channel-queue-backed-up) |
| `/internal/metrics` — `ingestion_channel_up{channel="as2"} == 0` | Prometheus / Grafana | [Channel queue backed up](#channel-queue-backed-up) |
| `MISSING_ACK` alert (Phase 7) | Alerts page / email / Slack | Partner-specific — investigate via lifecycle view first. |
| `REJECTION_RATE_SPIKE` alert (Phase 7) | Alerts page / email / Slack | Partner-specific — start from `/transactions?partner=...&status=PARSE_ERROR`. |
| `STALE_TRAFFIC` alert (Phase 7) | Alerts page / email / Slack | Partner-specific — confirm the partner is still sending; check [Channel queue backed up](#channel-queue-backed-up). |
| Latency p95 > 500 ms (CW alarm — Sprint 5 follow-up) | CloudWatch | [Performance regression](#performance-regression) |
| 5xx error rate > 1% (CW alarm — Sprint 5 follow-up) | CloudWatch | [Performance regression](#performance-regression) |
| Rate-limit `429` flood in audit (`rate.exceeded`) | Audit log query | Investigate the tenant — flag a paying customer is hitting limits; tune via `rateLimits` overrides ([Capacity callouts](#capacity-callouts)). |
| Manual user report: "I performed X and it didn't save" | Slack / email | [Audit row missing](#audit-row-missing) |
| Customer email: "remove my data" | Inbox | [Tenant deletion request](#tenant-deletion-request) |
| ANY hint of cross-tenant visibility | Anywhere | [Cross-tenant data leak (nuclear)](#cross-tenant-data-leak-nuclear) — escalate immediately. |

---

## Restoring the database

**Symptom.** The primary RDS instance is unrecoverable (data corruption,
accidental delete, region outage), OR you need a clean copy of production
for staging.

**Two restore paths.** Pick whichever is fresher and closer to the
target environment:

| Path | Recency | Same-region only? | Use when |
|---|---|---|---|
| **A. RDS automated snapshot** | Daily, ~5 min RPO | Yes | Routine restore inside the same region. Faster — `RestoreDBInstanceFromDBSnapshot` runs in minutes. |
| **B. Weekly `pg_dump` from S3** | Weekly, 7-day RPO worst case | No (cross-region replica available) | Region outage; long-horizon disaster recovery; verifying logical backup integrity. |

### Path A — Restore from RDS snapshot

1. Identify the source snapshot.

   ```bash
   aws rds describe-db-snapshots \
     --db-instance-identifier edi-hub-prod \
     --query 'reverse(sort_by(DBSnapshots, &SnapshotCreateTime))[0:5]'
   ```

2. Restore into a new instance. **Do NOT overwrite the existing one** —
   we restore side-by-side, smoke-test, then cut over.

   ```bash
   aws rds restore-db-instance-from-db-snapshot \
     --db-instance-identifier edi-hub-restore-$(date -u +%Y%m%d%H%M) \
     --db-snapshot-identifier <SNAPSHOT_ID> \
     --db-instance-class db.t4g.small \
     --db-subnet-group-name edi-hub-prod \
     --vpc-security-group-ids <db_security_group_id> \
     --kms-key-id alias/aws/rds \
     --no-publicly-accessible \
     --deletion-protection
   ```

3. Wait for `available` status:

   ```bash
   aws rds wait db-instance-available --db-instance-identifier <new id>
   ```

4. Apply pending Prisma migrations (a restored snapshot is at the snapshot's
   migration level; live code may be newer):

   ```bash
   DATABASE_URL="postgres://<user>:<pwd>@<new-endpoint>:5432/edi_hub?sslmode=require" \
     npm run db:migrate:deploy --workspace=packages/db
   ```

5. Smoke test (see [Smoke checklist](#post-restore-smoke-checklist) below).

6. Cut over: update the `DATABASE_URL` secret in Secrets Manager to point
   at the new endpoint, then force-redeploy the API service:

   ```bash
   aws secretsmanager put-secret-value \
     --secret-id edi/prod/DATABASE_URL \
     --secret-string "postgres://...@<new-endpoint>:5432/edi_hub?sslmode=require"

   aws ecs update-service --cluster <cluster> --service edi-hub-api --force-new-deployment
   ```

7. Once stable for ≥1 hour, delete the old instance:

   ```bash
   aws rds modify-db-instance --db-instance-identifier edi-hub-prod \
     --no-deletion-protection --apply-immediately
   aws rds delete-db-instance --db-instance-identifier edi-hub-prod \
     --final-db-snapshot-identifier edi-hub-prod-pre-restore-$(date -u +%Y%m%d)
   ```

### Path B — Restore from `pg_dump` in S3

1. List available dumps. Newest first:

   ```bash
   aws s3 ls s3://<backup_bucket_name>/edi-hub/ --recursive \
     | sort -r | head -10
   ```

2. Stand up a new empty RDS instance per Path A step 2 (skip the
   `--db-snapshot-identifier` arg; use `create-db-instance` instead).

3. Wait for `available`.

4. Run the convenience restore script:

   ```bash
   ./ops/scripts/restore-from-pgdump.sh \
     --bucket <backup_bucket_name> \
     --key   edi-hub/2026-W12/db.dump \
     --target "postgres://<user>:<pwd>@<new-endpoint>:5432/edi_hub?sslmode=require"
   ```

5. Apply Prisma migrations, smoke test, and cut over per Path A
   steps 4–7.

### Post-restore smoke checklist

Run these against the restored instance BEFORE cutting over. All four
must pass.

| # | Check | How |
|---|---|---|
| 1 | Row counts within 1% of the live snapshot | `SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;` on both DBs, compare. |
| 2 | Most recent raw_file ingested-at timestamp matches the dump's expected window | `SELECT max(ingested_at) FROM raw_files;` |
| 3 | API boots and `/readiness` returns 200 | Deploy the API to a staging task pointed at the new DB; curl `/readiness`. |
| 4 | A representative lifecycle query returns expected results | `curl /lifecycle?po=<known PO>` against the staging deployment. |

### Drilling the restore

Once per quarter — minimum — run a non-emergency restore drill against
staging. Don't skip this: untested backups are aspirational backups.

1. Pick the most recent weekly `pg_dump` from production's bucket.
2. Restore into a fresh staging RDS instance using Path B.
3. Walk the smoke checklist above.
4. Tear down the restored instance.
5. Append an entry to `ops/RESTORE_LOG.md` — drill date, who ran it,
   elapsed time, smoke checklist result, anything that needed tweaking.

The CloudWatch alarm `edi-hub-backup-stale-prod` catches "backups stopped
happening." The quarterly drill catches "backups happen but don't restore."

---

## Backup stale

**Symptom.** `edi-hub-backup-stale-prod` CloudWatch alarm fires.
SNS routes it to the on-call channel.

**First checks** (≤5 min):

1. Did the EventBridge rule run at the scheduled time?

   ```bash
   aws events list-targets-by-rule --rule edi-hub-backup-prod
   aws logs tail /edi-hub/prod/backup --since 14d | head -100
   ```

2. Did the ECS task start? Look in the cluster for recent stopped tasks.

   ```bash
   aws ecs list-tasks --cluster <cluster> --family edi-hub-backup-prod \
     --desired-status STOPPED --max-results 5
   ```

3. If the task started but failed, read its `stoppedReason`:

   ```bash
   aws ecs describe-tasks --cluster <cluster> --tasks <task-arn>
   ```

**Common causes and fixes:**

| Cause | Symptom in logs | Fix |
|---|---|---|
| Image tag rotated, ECR pull denied | `CannotPullContainerError` | Re-push the image; check the task execution role's ECR permissions. |
| Secrets Manager value rotated, format broken | `pg_dump: error: missing "=" after ...` | Verify `DATABASE_URL` in Secrets Manager is a valid Postgres URI with `sslmode=require`. |
| Network ACL change blocks DB | `pg_dump: ... could not connect` | Confirm the backup task subnet + SG can reach the RDS endpoint on 5432. |
| S3 bucket policy rejected the PUT | `An error occurred (AccessDenied)` | Reapply `infra/backups.tf`; check the SSE header is `AES256`. |

**Manual recovery** — kick off a backup run by hand if the schedule is
broken and you want today's bytes safe before fixing the root cause:

```bash
aws ecs run-task \
  --cluster <cluster> \
  --task-definition edi-hub-backup-prod \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[<subnet>],securityGroups=[<sg>],assignPublicIp=DISABLED}"
```

The task emits the `BackupSuccess` heartbeat on success — the alarm
clears within one period.

**Escalation:** if you can't resolve in 1 hour, page the author.
Backups stale doesn't mean DB is lost; it means RPO is increasing.
Don't panic; do call out the widening window.

---

## Setting up SNS → Slack

One-time per environment. SNS topic ARN is in the Terraform output
`oncall_sns_topic_arn`.

1. In Slack, install the "AWS Chatbot" app and authorise it for the
   target workspace + channel.
2. In the AWS console → AWS Chatbot → Configured clients → Slack →
   New configuration. Pick the channel.
3. Add the `edi-hub-oncall-<env>` SNS topic as a notification source.
4. Test: publish a synthetic message.

   ```bash
   aws sns publish \
     --topic-arn <topic-arn> \
     --subject "Test alarm — please ignore" \
     --message "If you see this in #oncall, the wiring is good."
   ```

Once verified, every alarm declared in `infra/alarms.tf` fans out to the
same channel.

---

## Performance regression

**Symptom.** A k6 baseline run misses Gate E (p95 read > 500 ms, p95
ingest > 2 s, error > 1% / 5%), OR a CloudWatch latency alarm fires in
production.

**First checks** (≤10 min):

1. **Is the regression environmental or code?** Compare the current
   `ops/load/baseline.md` row's commit SHA against the last green one.
   A delta means a code change; no delta means infra (DB autoscale,
   ALB, etc.).
2. **Where's the latency landing?** Open `/internal/metrics` and look at
   `http_request_duration_seconds_bucket` per route. A single route
   pegged at the slowest bucket is the smoking gun.
3. **What's saturated?** See [Capacity callouts](#capacity-callouts)
   below — pick the resource that matches the symptom.

**Mitigation by symptom:**

| Symptom | First-line mitigation | Where to look |
|---|---|---|
| Single route slow, others fine | Add an index / inspect Prisma query plan | Postgres `EXPLAIN ANALYZE`; commit a migration. |
| Every route slow, CPU pegged | Scale up the ECS service | `aws ecs update-service --desired-count N`. |
| Every route slow, CPU idle | DB or S3 is the bottleneck | RDS Performance Insights + S3 metrics. |
| 503s on writes only | DB connection pool full | Bump `connection_limit` in Prisma URL; raise `max_connections` in the RDS parameter group. |

**Rollback.** If a code change is the culprit, revert via
`aws ecs update-service --force-new-deployment` after rolling back the
container image tag. Document the rollback in the next baseline row so
the regression is permanent record.

---

## Capacity callouts

Each subsystem has a hard ceiling. When you hit it, this is what it
looks like and how to widen.

### Postgres connection pool

- **Symptom.** Writes return `503 DB_UNAVAILABLE` under load; reads
  queue. Prisma logs `Timed out fetching a new connection from the pool`.
- **Default ceiling.** Prisma's `connection_limit` defaults to `num_cpus * 2 + 1`
  (so ~9 on a t4g.small task). Combined with RDS `max_connections`
  (~200 on db.t4g.small), each task can comfortably hold ~10.
- **Widen.** Bump the connection string: `?connection_limit=20&pool_timeout=10`.
  Then bump RDS parameter group `max_connections` if total tasks ×
  connection_limit > 80% of the RDS ceiling. Connection cost is
  ~10 MB RAM each — sizing matters.

### S3 PUT/GET throttling

- **Symptom.** Ingest 5xx error rate spikes; retries succeed. S3 metric
  `5xxErrors` non-zero.
- **Default ceiling.** 3500 PUT/sec, 5500 GET/sec per prefix. We
  partition by date (`raw/YYYY/MM/DD/`) so the prefix changes daily.
- **Widen.** Already partitioned — for sustained > 3000 PUT/sec, switch
  to `raw/<hash-prefix>/YYYY/MM/DD/` so multiple prefixes share traffic.
  Not needed at Gate E volumes.

### Multipart upload timeout

- **Symptom.** Ingest 413 (request too large) or premature connection
  close on uploads > `maxFileSizeBytes`.
- **Default ceiling.** 25 MB (`MAX_FILE_SIZE_BYTES`).
- **Widen.** Bump the env var. The ALB also has a 60-second idle
  timeout; raise via `aws_lb.api.idle_timeout` if real uploads start
  hitting it. (50 MB files at slow uplinks are the typical trigger.)

### Rate-limit bucket

- **Symptom.** Tenants see 429s with `Retry-After`. Audit log shows
  `rate.exceeded` rows for the same tenant repeatedly.
- **Default ceilings.** read 600/min, write 60/min, ingest 10/min,
  webhook 60/min (per tenant or per IP).
- **Widen.** Pass `rateLimits: { read: { perMinute: 1200 } }` to
  `buildServer` (or expose via config — currently a hardcoded
  default). With multi-task ECS, each task enforces independently;
  effective ceiling is `tasks × perMinute`.

### Fastify body size

- **Symptom.** Non-multipart POST returns 413 with `FST_ERR_CTP_BODY_TOO_LARGE`.
- **Default ceiling.** 25 KB global; multipart bypasses to the
  `maxFileSizeBytes` limit above.
- **Widen.** Bump `bodyLimit` in `apps/api/src/server.ts`. Partner-
  config is the only route that could realistically grow (large
  `contacts` arrays, flow definitions); 25 KB holds for the foreseeable.

---

## DB unreachable

**Symptom.** `/readiness` returns 503 with `{ db: "error" }`. API writes
return `503 DB_UNAVAILABLE`. Ingest refuses to write to S3 ("fail fast"
behavior — we do NOT write bytes when the DB is unreachable).

**First checks** (≤5 min):

1. Is the RDS instance up?

   ```bash
   aws rds describe-db-instances --db-instance-identifier edi-hub-prod \
     --query 'DBInstances[0].DBInstanceStatus'
   ```

2. Can the API task reach RDS on 5432? From the ECS task (`aws ecs execute-command`):

   ```bash
   nc -vz <rds-endpoint> 5432
   ```

3. Is the `DATABASE_URL` secret still valid? A rotated master password,
   a moved endpoint, or a missing `sslmode=require` all surface as
   "unreachable" from the API's POV.

**Common causes:**

| Cause | Clue | Fix |
|---|---|---|
| RDS in `modifying` / `rebooting` | `aws rds describe-db-instances` shows non-`available` | Wait. Most maintenance < 5 min. |
| Security-group rule deleted | `nc -vz` times out | Re-apply `infra/rds.tf` (it provisions the ingress-from-app-SG rule). |
| Password rotated, secret not updated | `pg_hba.conf entry` / `password authentication failed` in logs | Update `DATABASE_URL` secret in Secrets Manager; force ECS redeploy. |
| `sslmode=require` stripped | `connection requires SSL` | Add `?sslmode=require` to the secret. |
| Storage full | RDS `FreeStorageSpace` alarm | Scale storage via `aws rds modify-db-instance --allocated-storage`. |

**Mitigation.** None — DB has to come back. If it's a hard outage
(>15 min), consider triggering a restore into a fresh instance (see
[Restoring the database](#restoring-the-database) — Path A is faster
than Path B for same-region failures).

**Rollback.** N/A — there's no code change to revert; this is an infra
event.

**Escalation.** If RDS itself is healthy but the API still can't reach
it after both the security group and the secret are verified, page the
author. Suspect VPC routing / NAT change.

---

## S3 unreachable

**Symptom.** `/readiness` returns 503 with `{ s3: "error" }`. Ingest
returns 5xx on `/ingest/upload`. Existing reads of already-stored raw
files (`GET /raw-files/:id/content`) fail.

**First checks** (≤5 min):

1. AWS service health for S3 in our region:

   ```bash
   aws health describe-events --filter "regions=us-east-1,services=S3"
   ```

2. Is the IAM role still attached? `aws iam list-attached-role-policies
   --role-name <api-task-role>` should include `edi-ingestion-<env>`.

3. Has the bucket policy drifted? `aws s3api get-bucket-policy --bucket
   edi-raw-files-prod` — confirm the `DenyUnencryptedPut` /
   `DenyInsecureTransport` statements are still there AND the API
   request matches them (it should — `ServerSideEncryption: 'AES256'`
   is hardcoded in `apps/api/src/storage/s3.ts`).

**Common causes:**

| Cause | Clue | Fix |
|---|---|---|
| Real S3 region outage | AWS Health Dashboard | Wait. Read the AWS post-incident report. |
| KMS key disabled | `KMSAccessDeniedException` in logs | Re-enable the key in KMS console; we use `aws/s3` managed key today. |
| Bucket policy mutated | `AccessDenied` on PUT | Re-apply `infra/s3.tf`. |
| IAM role missing `s3:PutObject` | `AccessDenied` on PUT | Re-apply `infra/s3.tf` (it provisions `aws_iam_policy.ingestion`). |

**Mitigation.** None — ingest stops; HTTP upload returns 5xx with a
clear message. Operators can fall back to manual file capture (drop
into the SFTP folder when it recovers).

**Rollback.** Same as DB — no code rollback.

**Escalation.** S3 outage > 1 hour, escalate to the author. We don't
have a failover bucket today.

---

## Channel queue backed up

**Symptom.** `/internal/metrics` shows `ingestion_channel_up{channel="sftp"} == 0`
(or `as2 == 0`). Files visibly accumulating in the watch folder.
`STALE_TRAFFIC` Phase 7 alert may fire.

**First checks** (≤10 min):

1. What does `/health` report for the channel?

   ```bash
   curl https://api.<env>.edihub.example.com/health | jq '.channels'
   ```

   Look for `error: "..."` on the affected channel.

2. Is the watch folder readable by the API task user? `aws ecs
   execute-command` into the task, `ls -la /path/to/watch/dir`.

3. Is there a stuck file? Files that the watcher considers "still being
   written" (modified within the stability threshold) won't be picked
   up. Check `ls -lt` for old files in `incoming/`.

**Common causes:**

| Cause | Clue | Fix |
|---|---|---|
| OpenAS2 sidecar crashed | `as2` channel `status: 'error'` | Restart the sidecar container: `docker compose restart openas2`. |
| Permission flipped on watch dir | `EACCES` in channel error | `chmod`/`chown` to the task user. |
| Stability threshold too tight | Files appear and immediately retry | Bump `SFTP_STABILITY_MS` / `AS2_STABILITY_MS` env. |
| Disk full (failed/processed folders) | Channel still "running" but no progress | Clean `failed/` and `processed/`; retention sweep should now run. |

**Mitigation.** While the channel is down, partners can be redirected
to the HTTP `/ingest/upload` endpoint (admin/ops role required). This
should be a last resort — it bypasses the channel's audit trail.

**Rollback.** N/A — channels are read-only consumers.

**Escalation.** > 4-hour channel outage with files accumulating, page
the author. Customer may need an SLA credit.

---

## Clerk webhook drift

**Symptom.** A user signs into Clerk successfully but the API returns
`403 TENANT_NOT_PROVISIONED` or `403 USER_NOT_PROVISIONED`. New user
signups don't show up under `GET /users`.

**First checks** (≤5 min):

1. Is the webhook endpoint reachable from Clerk's side?

   In the Clerk dashboard → Webhooks → check the recent deliveries.
   Look for non-2xx responses. The API's response body tells you which
   stage failed.

2. Is `CLERK_WEBHOOK_SECRET` still the right value? A rotated Svix
   signing secret causes signature verification to fail silently
   (we return `503 WEBHOOK_NOT_CONFIGURED` on blank, `401` on bad
   signature). Check Secrets Manager.

3. Did a webhook delivery actually arrive? Check
   `/edi-hub/<env>/api` CloudWatch logs for `/webhooks/clerk` log lines.

**Common causes:**

| Cause | Clue | Fix |
|---|---|---|
| `CLERK_WEBHOOK_SECRET` rotated, hub still has the old one | 401 in webhook logs | Update Secrets Manager; force ECS redeploy. |
| Webhook URL wrong in Clerk | No log lines at all | Reconfigure the Clerk webhook to `https://api.<env>.edihub.example.com/webhooks/clerk`. |
| Org / user created before the webhook was wired | The row never landed | Manually create the tenant + user via `apps/api/src/scripts/attach-pilot-org.ts` adapted to the new org id. |
| Webhook handler erroring | 5xx in webhook logs | Read the structured error; usually a missing field in the Clerk payload. |

**Mitigation.** While drift persists, an admin can manually provision
the missing Tenant/User row via the attach-pilot-org pattern. Document
the manual entries in `ops/RUNBOOKS.md` so a future audit can reconcile.

**Rollback.** If a recent code change broke the webhook handler, revert
the API service to the prior task definition revision.

**Escalation.** If Clerk's webhook delivery dashboard shows our endpoint
returning 5xx repeatedly, page the author within an hour — every minute
of drift is sign-in failures for new users.

---

## Tenant deletion request

**Symptom.** A customer requests data removal (GDPR / contract
termination), or a staff support ticket asks you to deprovision a tenant.

**Procedure:**

1. **Verify the request is legitimate.** The request must come from a
   verified admin contact on file (NOT an arbitrary email). If unsure,
   contact the admin via Clerk dashboard's user record and confirm.

2. **Confirm the scope.** Whole-tenant deletion is the only supported
   self-service path. Per-row redaction is not in v1 — escalate to the
   author for partial deletion needs.

3. **Initiate via the API** — admin-role only, the admin themselves should run:

   ```bash
   curl -X DELETE https://api.<env>.edihub.example.com/tenants/me \
     -H "Authorization: Bearer <admin JWT>"
   ```

   Response is `202 Accepted` with `hardDeleteAfter` — typically 30
   days from now. The Tenant row is soft-deleted; everything else is
   intact until the sweeper runs.

4. **Communicate the timeline.** Confirm to the customer: "Soft-deleted
   today; hard-deleted on <date>. Reversible until that date via
   `POST /tenants/me/undelete`."

5. **Track to completion.** On the hard-delete date, confirm the
   sweeper ran (audit row `tenant.hard-deleted` for the tenant id).
   Send a final confirmation email.

**Reversal** — within the grace window, an admin can:

```bash
curl -X POST https://api.<env>.edihub.example.com/tenants/me/undelete \
  -H "Authorization: Bearer <admin JWT>"
```

(Returns 204 idempotently.)

**Escalation.** If the customer demands hard-delete inside the grace
window (legal pressure), the author can run the sweeper with a
zero-day grace from the script — but log this carefully and confirm
in writing.

---

## Cross-tenant data leak (nuclear)

**This is the most important runbook in this file.** If you suspect
even circumstantially that one tenant saw another tenant's data, treat
it as a confirmed incident until proven otherwise.

**Immediate actions** (do these in order, do not skip):

1. **Page the author. Now.** Don't investigate alone — get a second
   pair of eyes.

2. **Preserve evidence.** Do NOT take corrective action that destroys
   logs or audit rows. Specifically:
   - Do NOT restart the API tasks.
   - Do NOT redeploy.
   - Do NOT delete or modify the suspect audit rows.

3. **Snapshot the audit log** for the suspected tenant pair:

   ```sql
   SELECT * FROM audit_events
    WHERE tenant_id IN ('<A>', '<B>')
      AND created_at > now() - interval '24 hours'
    ORDER BY created_at DESC;
   ```

   Export to a separate, access-controlled S3 bucket. The on-call
   account should have read-only access to its own audit by default.

4. **Snapshot the relevant business data:**

   ```sql
   SELECT tenant_id, count(*)
     FROM raw_files
    WHERE ingested_at > now() - interval '7 days'
    GROUP BY tenant_id;
   ```

   Same for `interchanges`, `transactions`, `alerts` if relevant. Look
   for a row tagged with the wrong `tenant_id`.

5. **Reproduce or refute.** With the author, try to reproduce the leak
   in staging:
   - Two known tenants, one's JWT, the other's resource id.
   - Curl every read endpoint with the wrong-tenant id.
   - The expected response is `404 NOT_FOUND` (see
     `SECURITY_CHECKLIST.md` §2.4).

**If confirmed** (the curl test succeeds in showing wrong-tenant data):

1. **Take the API offline.** Set the ALB target group's healthy threshold
   to a value that fails immediately, OR scale the ECS service to zero.
   Customers see 503; that's preferable to the leak continuing.
2. **Notify every affected tenant.** Be honest, be specific, be calm.
3. **Root-cause via the Sprint 6.2 (Phase 9) direct-DB inspection
   test pattern** — write a one-off query that scans for rows whose
   `tenant_id` doesn't match the join path that produced them.
4. **Patch.** Add a regression test BEFORE shipping the fix.
5. **Post-mortem.** Within 7 days. Add the failure mode to this runbook
   so the next operator catches it faster.

**If refuted** (curl tests show the expected 404s and the user is
mistaken about what they saw):

1. Explain the mistake to the user with screenshots of the actual
   request/response.
2. Still log the incident in `ops/RESTORE_LOG.md` (or a new
   `ops/INCIDENT_LOG.md`) — false-positive isolation tests are still
   useful data.

**Why this section is paranoid.** Phase 9 invested heavily in making
this impossible at the code level (Prisma extension, tenant context,
exhaustive isolation tests). But "impossible" is a confidence interval,
not a proof. Treat the first hint as real and walk it down with
evidence.

---

## Audit row missing

**Symptom.** A user did something (acked an alert, edited a partner,
demoted a user) but `GET /audit?action=<verb>&actorId=<user>` doesn't
return the expected row.

**First checks** (≤5 min):

1. Did the action actually succeed? Check the user's request in the
   structured request logs:

   ```text
   route: /partners-config/:id
   method: PATCH
   status: 200
   ```

   If status is 4xx/5xx, no audit row — the user's mutation didn't
   commit, by design (`withAudit` wraps in `$transaction`).

2. Did the audit insert fail and roll back? `failed audit insert
   surfaces as a 500` (per `audit.test.ts`); if the user got a 500,
   the data write rolled back along with the audit.

3. Is the audit row in a different tenant? A bug where the actor was
   in tenant A but the audit row landed under tenant B would be a
   cross-tenant smell — escalate to
   [Cross-tenant data leak (nuclear)](#cross-tenant-data-leak-nuclear)
   if confirmed.

**Common causes:**

| Cause | Clue | Fix |
|---|---|---|
| User's mutation got a 4xx (e.g. 409 conflict) | Request log shows non-2xx | Working as designed — no audit on rejection. |
| Mutation got a 500 from audit-insert failure | Request log shows 500 + DB error | Investigate the audit table (lock contention? disk?). Re-do the mutation. |
| Audit row landed but the filter is wrong | `GET /audit` without filter returns the row | UI / query bug — re-query without filters. |
| New route bypassed `withAudit` | New code; audit policy in `CLAUDE.md` §3 | Wrap the route in `withAudit` and write a regression test. |

**Mitigation.** Re-run the user's intended action so a fresh audit row
lands. If audit was the failing path (DB pressure on `audit_events`),
defer non-critical writes until pressure clears.

**Rollback.** If a new code change deployed without `withAudit`
coverage, revert and re-ship with the wrap.

**Escalation.** Pattern of missing audit rows from many users at once →
suspect DB pressure on the audit table. Check the slowest-query log
in RDS Performance Insights.
