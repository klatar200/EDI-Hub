# Path A — SaaS to first external customer

**Chosen track:** Production deploy → UI overhaul → Phase 11 commercialization → Phase 12 pilot.

**Canonical checklists:** `ops/PRE_PRODUCTION_TODO.md` (operator steps), `SECURITY_CHECKLIST.md` (sign-off), `BUILD_PLAN.md` (phase map).

**Rule:** Each sprint ends in something demoable or signed off. Operator steps need your AWS + Clerk credentials — the agent prepares code/docs; you run `terraform apply` and dashboard wiring.

---

## Sprint A1 — Staging environment (current)

**Goal:** A HTTPS staging API that the web app can talk to, backed by real RDS + S3 + Secrets Manager.

**Exit criteria:** `curl https://<staging-domain>/health` → 200; Clerk login works; one test ingestion lands in S3 + Postgres.

### A1.1 — AWS prerequisites (you)

- [ ] AWS account + IAM user/role with rights for VPC (or use existing VPC), RDS, S3, ALB, ACM, Route 53, Secrets Manager, ECS, CloudWatch.
- [ ] Route 53 hosted zone (or registrar you can point at ALB).
- [ ] Choose region (default in docs: `us-east-1`).

### A1.0 — Install toolchain (you, one-time)

Terraform and the AWS CLI are **not** in this repo — install them on the machine
where you run `terraform apply`.

#### Windows (PowerShell)

**1. Terraform** — pick one:

```powershell
# Option A: winget (Windows 10/11)
winget install HashiCorp.Terraform

# Option B: Chocolatey
choco install terraform

# Option C: Manual — download the Windows amd64 zip from
# https://developer.hashicorp.com/terraform/install
# Unzip, add the folder to your user PATH, then open a NEW PowerShell window.
```

Verify (new window after install):

```powershell
terraform version
```

**2. AWS CLI** (if not already installed):

```powershell
winget install Amazon.AWSCLI
aws --version
aws configure   # Access key, secret, region (e.g. us-east-1)
```

**3. Environment variable for the DB password** — PowerShell does **not** use `export`:

```powershell
# Session only (recommended while learning):
$env:TF_VAR_db_master_password = 'your-strong-random-password-here'

# Or set for your user permanently:
[System.Environment]::SetEnvironmentVariable(
  'TF_VAR_db_master_password',
  'your-strong-random-password-here',
  'User'
)
# Close and reopen PowerShell after the permanent form.
```

> Do not paste real passwords into chat or commit them to git. `staging.tfvars`
> stays secret-free; the password goes only in `$env:TF_VAR_*` or Secrets Manager.

#### macOS / Linux (bash)

```bash
# Terraform: https://developer.hashicorp.com/terraform/install
# AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
export TF_VAR_db_master_password='your-strong-random-password-here'
```

---

### A1.2 — Terraform baseline (you)

**Copy tfvars** (already done if you ran the copy step):

```powershell
# PowerShell (from repo root)
Copy-Item infra/env/staging.tfvars.example infra/env/staging.tfvars
# Edit infra/env/staging.tfvars — VPC/subnet/zone/domain ids (no secrets).
```

```bash
# bash
cp infra/env/staging.tfvars.example infra/env/staging.tfvars
```

**Apply** — from `infra/`:

```powershell
# PowerShell
cd infra
$env:TF_VAR_db_master_password = 'your-strong-random-password-here'

terraform init
terraform apply -target=aws_s3_bucket.raw_files -var-file=env/staging.tfvars
terraform apply -target=aws_kms_key.secrets -var-file=env/staging.tfvars
terraform apply -var-file=env/staging.tfvars
```

```bash
# bash
cd infra
export TF_VAR_db_master_password='your-strong-random-password-here'

terraform init
terraform apply -target=aws_s3_bucket.raw_files -var-file=env/staging.tfvars
terraform apply -target=aws_kms_key.secrets -var-file=env/staging.tfvars
terraform apply -var-file=env/staging.tfvars
```

Check off items in `ops/PRE_PRODUCTION_TODO.md` § Infrastructure apply as you complete them.

### A1.3 — Secrets Manager (you)

After RDS exists, build `DATABASE_URL` with `sslmode=require`. Populate:

| Secret | Source |
|--------|--------|
| `DATABASE_URL` | RDS endpoint from Terraform output |
| `CLERK_SECRET_KEY` | Clerk dashboard → API Keys (`sk_test_…` for staging) |
| `CLERK_WEBHOOK_SECRET` | Clerk → Webhooks → signing secret |
| `GLOBAL_SLACK_WEBHOOK` | Optional — Slack incoming webhook URL |

See `CLERK_SETUP.md` for the full Clerk walkthrough.

### A1.4 — Clerk staging app (you)

- [ ] Create **EDI Data Hub (staging)** application in Clerk.
- [ ] Enable Organizations (Hobby plan minimum).
- [ ] Add staging web origin + redirect URIs for your staging URL.
- [ ] Configure webhook → `https://<staging-domain>/webhooks/clerk`.
- [ ] Set `VITE_CLERK_PUBLISHABLE_KEY` in the web build / hosting env (`pk_test_…`).

### A1.5 — API + web deploy (you)

Terraform in this repo covers **data plane** (RDS, S3, ALB, secrets, backup task). ECS service / container image for the API may still need a one-time setup in your AWS account (task definition, ECR image, target group attachment). If not yet wired:

1. Build and push API container (or run API on ECS Fargate using your existing pattern).
2. Point ALB target group at the API service; health check path `/readiness`.
3. Deploy web static assets (S3 + CloudFront, or serve from API via `@fastify/static`).

*Agent follow-up:* if you want API ECS in Terraform, say so — we can add `infra/api-service.tf` in a follow-on sprint.

### A1.6 — Smoke test (you)

Run the four checks in `infra/README.md` § "Verifying the security posture" against staging.

---

## Sprint A2 — Operational proof (M5 in production)

**Goal:** Phase 10 exit checklist in `ops/PRE_PRODUCTION_TODO.md` all ✅.

| Task | Doc |
|------|-----|
| First restore drill | `ops/RUNBOOKS.md` → append `ops/RESTORE_LOG.md` |
| k6 load baseline (2 runs within 10%) | `ops/load/README.md` → `ops/load/baseline.md` |
| SNS → Slack test message | `ops/RUNBOOKS.md` |
| Security checklist sign-off | `SECURITY_CHECKLIST.md` |
| Runbook cold-read | `ops/RUNBOOKS.md` |
| Rate limit 429 in staging | Hit limit → confirm audit row |
| Retention task deployed + daily audit row | `ops/PRE_PRODUCTION_TODO.md` § retention |

When all five Phase 10 exit items pass: tag `m5-production-ready`, update `BUILD_PLAN.md`.

---

## Sprint A3 — UI overhaul

**Goal:** Lifecycle + alerts views are easier to scan; no cosmetic-only churn.

**Blocker:** Resolve `PHASE_UI_PLAN.md` decision gates **A / B / C** (Keagan picks — defaults provided).

Then 1–2 sprints implementing scoped changes only.

---

## Sprint A4 — Phase 11 commercialization

**Blocker:** Resolve **Gate 4** — self-serve (Stripe) vs. direct sales.

Then: billing tiers, onboarding flow, marketing site, ToS / Privacy / DPA, customer docs.

**Also resolve before selling:** BUILD_PLAN §10 **Q7** (data rights) and **Q11** (business entity).

---

## Sprint A5 — Phase 12 external pilot (M6)

Recruit 1–2 non-employer design partners → feedback loop → first paid contract.

---

## What the agent does vs. what you do

| Owner | Work |
|-------|------|
| **Keagan** | AWS creds, `terraform apply`, Secrets Manager values, Clerk dashboard, DNS, smoke tests, drills, business/legal gates |
| **Agent** | Code fixes, Terraform additions, runbook gaps, UI implementation after gates, CI, tests |

**Start now:** Sprint **A1.0** — install Terraform + AWS CLI, then **A1.2** — fill
`infra/env/staging.tfvars`, set `$env:TF_VAR_db_master_password` (PowerShell) or
`export TF_VAR_db_master_password` (bash), run `terraform init` / `apply`.
