# Infrastructure

Local development uses `docker-compose.yml` at the repo root (Postgres + MinIO).
This folder holds the **real-AWS** definitions, applied per environment.

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
| `alb.tf` | Public ALB with HTTPS:443 (ACM cert, TLS 1.3 policy) and HTTP:80 → HTTPS redirect, Route 53 ALIAS, target group pointed at the API task. |
| `secrets.tf` | Four `aws_secretsmanager_secret` entries (DB URL + Clerk keys + Slack webhook) encrypted with a project-owned KMS CMK. |
| `openas2/` | AS2 sidecar config — see its own README. |

## Apply order

Apply in this order on a fresh environment. Each step is independently
runnable so a partial environment can be reconciled by re-running.

```bash
cd infra
terraform init

# 1) Storage + secrets (no dependencies)
terraform apply -target=aws_s3_bucket.raw_files
terraform apply -target=aws_kms_key.secrets

# 2) Networking inputs — provide VPC/subnet/zone ids via tfvars
terraform apply -var-file=env/prod.tfvars

# 3) Populate the secret values out-of-band (AWS console or `aws secretsmanager
#    put-secret-value`). Never commit secret material to git or tfvars.
```

A starter `env/prod.tfvars` looks like:

```hcl
environment              = "prod"
bucket_name              = "edi-raw-files-prod"
environment_prefix       = "edi/prod"
db_name                  = "edi_hub"
db_master_username       = "edi_admin"
db_subnet_ids            = ["subnet-aaa", "subnet-bbb"]
db_allowed_security_group_ids = ["sg-api-task"]
vpc_id                   = "vpc-xxx"
public_subnet_ids        = ["subnet-public-a", "subnet-public-b"]
public_domain            = "api.edihub.example.com"
route53_zone_id          = "Z123EXAMPLE"
# db_master_password is provided via TF_VAR_db_master_password env var, not the file.
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
