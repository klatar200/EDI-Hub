# Infrastructure

> 🔒 **Go-live gate — not active.** Owner develops **locally only** (`docs/LOCAL_DEV.md`) until ready for paid AWS.  
> **Do not run `terraform apply`** during pre-launch development. When go-live: [`WINDOWS.md`](WINDOWS.md) · [`BUILD_PLAN.md`](../BUILD_PLAN.md) §9.

Local development uses `docker-compose.yml` at the repo root (Postgres + MinIO).
This folder holds the **real-AWS** definitions, applied per environment **after go-live**.

> Status: Phase 1 shipped the raw-file bucket. Phase 9 Sprint 4 added
> Secrets Manager entries. Phase 9 Sprint 5 added the encrypted RDS instance,
> S3 SSE enforcement, the public ALB with ACM-issued TLS, and the project-
> owned KMS CMK that encrypts every secret. Nothing here is applied
> automatically — `terraform apply` is a deliberate, credentialed step you run.

## What's here

| File | Purpose |
|---|---|
| `s3.tf` | Raw-file bucket — versioned, private, SSE-S3, bucket policy that denies un-encrypted or non-TLS access. |
| `rds.tf` | Encrypted Postgres 16, private subnets only, `rds.force_ssl=1`, deletion protection, 14-day backups. |
| `alb.tf` | Public ALB with HTTPS:443 (ACM cert, TLS 1.3 policy) and HTTP:80 → HTTPS redirect, Route 53 ALIAS, target group pointed at the API task. Health check: `/readiness`. |
| `ecs.tf` | ECS Fargate cluster, ECR repo, API task definition + service (same-origin web bundle via `WEB_STATIC_DIR`), IAM roles, task security group. |
| `secrets.tf` | Four `aws_secretsmanager_secret` entries (DB URL + Clerk keys + Slack webhook) encrypted with a project-owned KMS CMK. |
| `api-container/` | Dockerfile build/push runbook for the production API+web image. |
| `openas2/` | AS2 sidecar config — see its own README. |

## Prerequisites

Install **Terraform** (>= 1.5) and the **AWS CLI**, then configure AWS creds
(`aws configure`).

**Windows (PowerShell / VS Code):** see **[`WINDOWS.md`](WINDOWS.md)** — all operator commands
use `$env:TF_VAR_*` (not `export`). Project Cursor rule: `.cursor/rules/powershell-cli.mdc`.

## Apply order

Apply in this order on a fresh environment. Each step is independently
runnable so a partial environment can be reconciled by re-running.

```powershell
cd infra
terraform init

# 1) Storage + secrets (no dependencies)
terraform apply -target=aws_s3_bucket.raw_files
terraform apply -target=aws_kms_key.secrets

# 2) Networking inputs — provide VPC/subnet/zone ids via tfvars
terraform apply -var-file=env/staging.tfvars

# 3) Populate the secret values out-of-band (AWS console or `aws secretsmanager
#    put-secret-value`). Never commit secret material to git or tfvars.

# 4) Build and push the API image, set api_image in tfvars, re-apply.
#    See api-container/README.md for docker build + ECR push steps.
```

### Staging bootstrap (Sprint A1)

Minimal path to a running HTTPS hub:

1. **Storage + KMS** — targeted apply for S3 bucket and secrets CMK.
2. **Data plane** — RDS, ALB, Secrets Manager entries, CloudWatch log group.
3. **Secrets values** — paste `DATABASE_URL` (with `sslmode=require`), Clerk keys, optional Slack webhook.
4. **Container** — `docker build` from repo root (see [`api-container/README.md`](api-container/README.md)), push to ECR, set `api_image` + `clerk_publishable_key` in `env/staging.tfvars`.
5. **ECS service** — full `terraform apply` creates the Fargate service behind the ALB.
6. **Clerk** — authorized origin = `https://<public_domain>`; webhook = `https://<public_domain>/webhooks/clerk`.
7. **Smoke** — `curl https://<public_domain>/health` and sign in via the SPA.

Scheduled backups (`backup-task.tf`) require `backup_cluster_arn` from the ECS output — enable in a follow-up apply after the cluster exists.

A starter `env/staging.tfvars` looks like:

```hcl
environment              = "staging"
bucket_name              = "edi-raw-files-staging-YOUR_ACCOUNT_ID"
environment_prefix       = "edi/staging"
db_name                  = "edi_hub"
db_master_username       = "edi_admin"
db_subnet_ids            = ["subnet-aaa", "subnet-bbb"]
db_allowed_security_group_ids = []   # ecs.tf wires API → RDS automatically
vpc_id                   = "vpc-xxx"
public_subnet_ids        = ["subnet-public-a", "subnet-public-b"]
public_domain            = "app.staging.edihub.example.com"
route53_zone_id          = "Z123EXAMPLE"
clerk_publishable_key    = "pk_test_..."
api_image                = "<account>.dkr.ecr.us-east-1.amazonaws.com/edi-hub-api-staging:<tag>"
# db_master_password via TF_VAR_db_master_password
```

Copy [`env/staging.tfvars.example`](env/staging.tfvars.example) as a starting point.

A production `env/prod.tfvars` looks like:

```hcl
environment              = "prod"
bucket_name              = "edi-raw-files-prod"
environment_prefix       = "edi/prod"
db_name                  = "edi_hub"
db_master_username       = "edi_admin"
db_subnet_ids            = ["subnet-aaa", "subnet-bbb"]
db_allowed_security_group_ids = []
vpc_id                   = "vpc-xxx"
public_subnet_ids        = ["subnet-public-a", "subnet-public-b"]
public_domain            = "app.edihub.example.com"
route53_zone_id          = "Z123EXAMPLE"
clerk_publishable_key    = "pk_live_..."
api_image                = "<account>.dkr.ecr.us-east-1.amazonaws.com/edi-hub-api-prod:<tag>"
# db_master_password via TF_VAR_db_master_password
```

## RDS encryption migration (existing-instance path)

For a pre-Sprint-5 instance that wasn't encrypted at rest:

1. Take a manual snapshot (`aws rds create-db-snapshot ...`).
2. Copy the snapshot with `--kms-key-id <CMK>` — copies are encrypted using
   the destination key.
3. Restore the copied snapshot to a new instance (`aws rds restore-db-instance-from-db-snapshot`).
   Use the same parameter group, subnet group, security group as the original.
4. Update the `DATABASE_URL` Secrets Manager entry to point at the new endpoint.
5. Cut over the API task (`aws ecs update-service --force-new-deployment`).
6. Once verified, delete the unencrypted original.

Plan ~30 minutes of downtime end-to-end on small instances; longer for large
ones. Run the rehearsal in staging first.

## Verifying the security posture

After apply, smoke-test:

```bash
# 1) HTTP redirects to HTTPS
curl -I http://api.edihub.example.com   # expect 301 with Location: https://...

# 2) HTTPS works and the response carries HSTS
curl -I https://api.edihub.example.com/health   # expect 200 + Strict-Transport-Security

# 3) S3 PUT without SSE is rejected
aws s3api put-object --bucket edi-raw-files-prod --key test-no-sse \
  --body /dev/null   # expect AccessDenied (the bucket policy)

# 4) Postgres rejects non-TLS connections
psql "host=<endpoint> user=edi_admin dbname=edi_hub sslmode=disable"
# expect: FATAL: no pg_hba.conf entry / SSL connection is required
```

The application never needs bucket-admin rights at runtime — only the
object-level permissions in `aws_iam_policy.ingestion`. Versioning means an
accidental overwrite never destroys earlier bytes ("raw file is sacred").
