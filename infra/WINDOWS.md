# Staging deploy on Windows (PowerShell)

Use this guide if you are on **Windows PowerShell** or **PowerShell 7** in VS Code.
Do **not** use `export` — that is bash/Linux/macOS syntax.

**New to AWS?** Start with [Part 0 — From zero](#part-0--from-zero-aws-account-passwords-clerk) below.

---

## Part 0 — From zero (AWS account, passwords, Clerk)

This section answers: *“Where do I get AWS and the Terraform password?”*

### 0.1 Create an AWS account

1. Open https://aws.amazon.com and click **Create an AWS Account**.
2. Complete email, password, account name, and payment method (AWS Free Tier still requires a card; RDS/ALB may incur small charges).
3. Sign in to the **AWS Console** as root or an admin user.

You do **not** download AWS from anywhere — you use the **web console** + **CLI credentials** you create in the next step.

### 0.2 Create CLI credentials (how `aws configure` gets its keys)

The Terraform and `aws` commands run **as you** via access keys (or SSO). Create an IAM user for day-to-day work:

1. AWS Console → search **IAM** → **Users** → **Create user**.
2. Name: e.g. `edi-hub-deploy`.
3. Attach policy: **AdministratorAccess** for first staging setup (tighten later).
4. Create user → open the user → **Security credentials** → **Create access key**.
5. Choose **Command Line Interface (CLI)** → create → copy:
   - **Access key ID** (looks like `AKIA...`)
   - **Secret access key** (shown once — save in a password manager)

In PowerShell:

```powershell
aws configure
```

Enter when prompted:

| Prompt | What to enter |
|--------|----------------|
| AWS Access Key ID | Your `AKIA...` key |
| AWS Secret Access Key | Your secret key |
| Default region name | `us-east-1` (matches this repo’s defaults) |
| Default output format | `json` |

Verify:

```powershell
aws sts get-caller-identity
```

You should see `"Account": "123456789012"` — save that **account ID** for S3 bucket names.

### 0.3 The “Terraform password” — you invent it

**There is no website or AWS page that gives you `TF_VAR_db_master_password`.**

It is the **master password for the Postgres database** Terraform will create on RDS. You choose it once and reuse it in two places:

1. **Before Terraform apply** (session env var):

```powershell
$env:TF_VAR_db_master_password = 'Pick-A-Long-Random-Password-Here!'
```

2. **After RDS exists** — inside the `DATABASE_URL` secret (same password, see §5).

Rules: 20+ characters, mixed case, numbers, symbols; no `@` or `/` in the password if you want to avoid URL-encoding headaches in `DATABASE_URL` (or URL-encode if you use them).

**Username** is not secret — it is `edi_admin` in `staging.tfvars` (`db_master_username`).

### 0.4 Get a domain in Route 53 (required for HTTPS)

This project’s Terraform creates an **ACM certificate** and **ALB** tied to a hostname in **Route 53**. You need a domain you control.

**Option A — Register in Route 53**

1. AWS Console → **Route 53** → **Registered domains** → **Register domains**.
2. Pick a name (e.g. `edihub-yourname.com`) and complete registration.

**Option B — Domain elsewhere**

1. Buy a domain at your registrar.
2. Route 53 → **Hosted zones** → **Create hosted zone** for that domain.
3. At your registrar, set the domain’s **nameservers** to the four NS records Route 53 shows.

For staging, pick a subdomain in tfvars, e.g. `app.staging.edihub-yourname.com`.

Get the hosted zone ID:

```powershell
aws route53 list-hosted-zones-by-name --dns-name "edihub-yourname.com" --query "HostedZones[0].Id" --output text
```

Output looks like `/hostedzone/Z1234567890ABC` — use **`Z1234567890ABC`** (without `/hostedzone/`) as `route53_zone_id` in tfvars.

### 0.5 VPC and subnet IDs (default VPC shortcut)

If you have not built a custom VPC, use the **default VPC**:

```powershell
$vpcId = aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text
Write-Host "vpc_id = $vpcId"

aws ec2 describe-subnets --filters "Name=vpc-id,Values=$vpcId" `
  --query "Subnets[*].[SubnetId,AvailabilityZone,MapPublicIpOnLaunch]" --output table
```

- **`public_subnet_ids`** — subnets where `MapPublicIpOnLaunch` is **True** (pick at least 2 in different AZs).
- **`db_subnet_ids`** — for a quick staging pass you can use the **same** subnet list as public (not ideal for production, but works to get started). Production should use **private** subnets.

### 0.6 Create Clerk (staging app)

1. Go to https://clerk.com → sign up / sign in.
2. **Create application** → name: `EDI Data Hub (staging)`.
3. **API keys** (left nav):
   - Copy **Publishable key** → `pk_test_...` → goes in `staging.tfvars` as `clerk_publishable_key`
   - Copy **Secret key** → `sk_test_...` → goes in Secrets Manager later (not tfvars)
4. **Organizations** → enable (needs **Hobby** plan for org-based multi-tenant in production; test keys work for staging setup).
5. **Webhooks** — add after you have a public URL:
   - URL: `https://<your public_domain>/webhooks/clerk`
   - Events: `organization.created`, `organization.updated`, `organizationMembership.created`, `organizationMembership.deleted`
   - Copy **Signing secret** → `whsec_...` → Secrets Manager later

### 0.7 Fill `staging.tfvars`

From repo root:

```powershell
Copy-Item infra\env\staging.tfvars.example infra\env\staging.tfvars
notepad infra\env\staging.tfvars
```

Example (replace every placeholder):

```hcl
environment              = "staging"
enable_scheduled_backups = false

bucket_name        = "edi-raw-files-staging-123456789012"   # use YOUR account id
environment_prefix = "edi/staging"

db_name            = "edi_hub"
db_master_username = "edi_admin"

vpc_id            = "vpc-0abc123..."
public_subnet_ids = ["subnet-aaa", "subnet-bbb"]
db_subnet_ids     = ["subnet-aaa", "subnet-bbb"]

public_domain   = "app.staging.edihub-yourname.com"
route53_zone_id = "Z1234567890ABC"

clerk_publishable_key = "pk_test_..."

# Set after Docker push to ECR (step 6) — use a dummy for first infra-only apply if needed
api_image = "123456789012.dkr.ecr.us-east-1.amazonaws.com/edi-hub-api-staging:initial"
```

Never put `db_master_password`, `sk_test_`, or `whsec_` in this file.

---

## 1. Install tools (one-time)

Open **PowerShell as Administrator** (or a normal shell if winget is on your PATH):

```powershell
winget install HashiCorp.Terraform
winget install Amazon.AWSCLI
```

Close and reopen PowerShell so `terraform` and `aws` are on your PATH.

Verify:

```powershell
terraform version
aws --version
aws sts get-caller-identity
```

If `terraform` is still not found:

```powershell
$env:Path += ";$env:LOCALAPPDATA\Microsoft\WinGet\Links"
terraform version
```

Optional for later: [Docker Desktop](https://www.docker.com/products/docker-desktop/) for building the API image.

---

## 2. Set session variables

```powershell
$env:TF_VAR_db_master_password = 'SamePasswordYouPickedInStep0.3'
$env:AWS_REGION = 'us-east-1'
$env:AWS_DEFAULT_REGION = 'us-east-1'
```

These last **only for this PowerShell window**. Re-set them if you open a new terminal.

---

## 3. Terraform apply

```powershell
cd infra
terraform init
terraform apply -target=aws_s3_bucket.raw_files -var-file=env/staging.tfvars
terraform apply -target=aws_kms_key.secrets -var-file=env/staging.tfvars
terraform apply -var-file=env/staging.tfvars
```

Review the plan, type `yes` when prompted.

After success:

```powershell
terraform output db_endpoint
terraform output api_ecr_repository_url
terraform output api_public_url
```

Save `db_endpoint` (host:port only, e.g. `edi-hub-staging.xxxx.us-east-1.rds.amazonaws.com:5432`).

**If apply fails on `api_image`:** push a Docker image first (§6), or temporarily comment out the ECS service in Terraform is not recommended — instead push any tag to ECR after the repo exists from a partial apply, or run apply once ECR exists from `terraform output api_ecr_repository_url`.

---

## 4. Populate Secrets Manager

Use the **same** DB password as `$env:TF_VAR_db_master_password`. Replace host from `terraform output db_endpoint` (hostname only, no `:5432` in the URL host part — standard format below includes port):

```powershell
$dbHost = "edi-hub-staging.xxxx.us-east-1.rds.amazonaws.com"
$dbPass = "SamePasswordYouPickedInStep0.3"

aws secretsmanager put-secret-value `
  --secret-id edi/staging/DATABASE_URL `
  --secret-string "postgresql://edi_admin:${dbPass}@${dbHost}:5432/edi_hub?sslmode=require"

aws secretsmanager put-secret-value `
  --secret-id edi/staging/CLERK_SECRET_KEY `
  --secret-string "sk_test_PASTE_FROM_CLERK"

aws secretsmanager put-secret-value `
  --secret-id edi/staging/CLERK_WEBHOOK_SECRET `
  --secret-string "whsec_PASTE_FROM_CLERK"
```

---

## 5. Build and push the API image

Requires Docker Desktop running.

From **repo root**:

```powershell
$env:VITE_CLERK_PUBLISHABLE_KEY = 'pk_test_SAME_AS_TFVARS'

docker build --build-arg VITE_CLERK_PUBLISHABLE_KEY=$env:VITE_CLERK_PUBLISHABLE_KEY -t edi-hub-api:local .

$accountId = (aws sts get-caller-identity --query Account --output text)
$region = 'us-east-1'
$ecrUri = "$accountId.dkr.ecr.$region.amazonaws.com/edi-hub-api-staging"
$tag = (Get-Date -Format 'yyyy-MM-dd') + '-' + (git rev-parse --short HEAD)

aws ecr get-login-password --region $region | docker login --username AWS --password-stdin "$accountId.dkr.ecr.$region.amazonaws.com"

docker tag edi-hub-api:local "${ecrUri}:${tag}"
docker push "${ecrUri}:${tag}"
```

Update `api_image = "<ecrUri>:<tag>"` in `infra\env\staging.tfvars`, then:

```powershell
cd infra
terraform apply -var-file=env/staging.tfvars
```

---

## 6. Clerk URLs + smoke test

In Clerk dashboard (staging app):

| Setting | Value |
|---------|--------|
| **Allowed origins** | `https://app.staging.edihub-yourname.com` (your `public_domain`) |
| **Webhook URL** | `https://app.staging.edihub-yourname.com/webhooks/clerk` |

Wait 2–5 minutes for ACM cert validation and ECS tasks to become healthy, then:

```powershell
curl.exe -I https://app.staging.edihub-yourname.com/health
curl.exe -I https://app.staging.edihub-yourname.com/readiness
```

Expect `HTTP/1.1 200`. Open the site in a browser and sign in with Clerk.

---

## Quick reference — where each secret comes from

| Item | Source |
|------|--------|
| AWS Access Key / Secret | IAM user → Security credentials → Create access key |
| `TF_VAR_db_master_password` | **You invent it** (password manager) |
| `db_master_username` | `staging.tfvars` (`edi_admin`) |
| `DATABASE_URL` | You build it: username + **your password** + RDS endpoint from `terraform output` |
| `pk_test_...` | Clerk → API keys → Publishable |
| `sk_test_...` | Clerk → API keys → Secret → Secrets Manager |
| `whsec_...` | Clerk → Webhooks → Signing secret → Secrets Manager |
| VPC / subnet IDs | `aws ec2 describe-*` or VPC console |
| Route 53 zone ID | Route 53 hosted zone or `aws route53 list-hosted-zones-by-name` |
| `api_image` | ECR after `docker push` |

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `export : not recognized` | Use `$env:NAME = 'value'` |
| `terraform : not recognized` | `winget install HashiCorp.Terraform`; reopen terminal |
| `aws : not recognized` | `winget install Amazon.AWSCLI`; reopen terminal |
| `No valid credential sources` | Run `aws configure` with IAM access keys |
| `AccessDenied` on apply | IAM user needs permissions (AdministratorAccess for first setup) |
| ACM cert stuck | DNS must point to Route 53; `public_domain` must match hosted zone |
| Full apply fails on `api_image` | Push image to ECR; set real tag in tfvars |

See also [`README.md`](README.md) and [`BUILD_PLAN.md`](../BUILD_PLAN.md) §9.
