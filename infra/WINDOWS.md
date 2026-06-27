# Staging deploy on Windows (PowerShell)

Use this guide if you are on **Windows PowerShell** or **PowerShell 7**. Do **not**
use `export` — that is bash/Linux/macOS syntax.

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
```

If `terraform` is still not found, add it manually (winget usually installs to):

```powershell
$env:Path += ";$env:LOCALAPPDATA\Microsoft\WinGet\Links"
terraform version
```

Configure AWS credentials (access key or SSO):

```powershell
aws configure
# or: aws configure sso
aws sts get-caller-identity   # should print your account id
```

## 2. Prepare tfvars

From the **repo root** (`EDI Hub`):

```powershell
Copy-Item infra\env\staging.tfvars.example infra\env\staging.tfvars
notepad infra\env\staging.tfvars
```

Fill in real values:

| Variable | Where to get it |
|---|---|
| `bucket_name` | Globally unique S3 name, e.g. `edi-raw-files-staging-123456789012` |
| `vpc_id`, `public_subnet_ids`, `db_subnet_ids` | AWS Console → VPC, or your existing staging VPC |
| `public_domain`, `route53_zone_id` | Route 53 hosted zone for your domain |
| `clerk_publishable_key` | Clerk dashboard → staging app → `pk_test_...` |
| `api_image` | Leave placeholder until after first ECR push (see step 5) |

Leave `enable_scheduled_backups = false` for the first apply.

## 3. Set the RDS password (this session only)

**PowerShell** — not `export`:

```powershell
$env:TF_VAR_db_master_password = 'YourStrongPasswordHere'
```

Use a strong password; you will embed it in the `DATABASE_URL` secret later.

Optional — pin AWS region for this session:

```powershell
$env:AWS_REGION = 'us-east-1'
$env:AWS_DEFAULT_REGION = 'us-east-1'
```

## 4. Terraform apply

```powershell
cd infra
terraform init
terraform apply -target=aws_s3_bucket.raw_files -var-file=env/staging.tfvars
terraform apply -target=aws_kms_key.secrets -var-file=env/staging.tfvars
terraform apply -var-file=env/staging.tfvars
```

Notes:

- Forward slashes in `-var-file=env/staging.tfvars` work in PowerShell.
- The full apply needs a valid `api_image` ECR URI. If you have not pushed an
  image yet, you can still apply everything **except** the ECS service by
  targeting resources, or push a placeholder image first (step 5).
- After RDS is created, note the endpoint from `terraform output db_endpoint`.

## 5. Populate Secrets Manager

Replace placeholders with real values (use your account id and RDS endpoint):

```powershell
aws secretsmanager put-secret-value `
  --secret-id edi/staging/DATABASE_URL `
  --secret-string "postgresql://edi_admin:YourStrongPasswordHere@YOUR_RDS_ENDPOINT:5432/edi_hub?sslmode=require"

aws secretsmanager put-secret-value `
  --secret-id edi/staging/CLERK_SECRET_KEY `
  --secret-string "sk_test_..."

aws secretsmanager put-secret-value `
  --secret-id edi/staging/CLERK_WEBHOOK_SECRET `
  --secret-string "whsec_..."
```

## 6. Build and push the API image

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/) on Windows.

From repo root:

```powershell
$env:VITE_CLERK_PUBLISHABLE_KEY = 'pk_test_...'   # same as clerk_publishable_key in tfvars

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

## 7. Clerk + smoke test

In Clerk (staging app):

- **Authorized origin:** `https://<your public_domain from tfvars>`
- **Webhook URL:** `https://<public_domain>/webhooks/clerk`

Smoke (PowerShell 7+ has `curl` as alias for `Invoke-WebRequest`; or use curl.exe):

```powershell
curl.exe -I https://app.staging.edihub.example.com/health
```

Expect HTTP 200.

## Troubleshooting

| Error | Fix |
|---|---|
| `export : The term 'export' is not recognized` | Use `$env:NAME = 'value'` in PowerShell |
| `terraform : The term 'terraform' is not recognized` | Install via winget; reopen terminal; check PATH |
| `aws : not recognized` | `winget install Amazon.AWSCLI`; reopen terminal |
| `Error: No valid credential sources` | Run `aws configure` or `aws sso login` |
| Full apply fails on `api_image` | Push Docker image to ECR first, set `api_image` in tfvars |

See also [`README.md`](README.md) and [`BUILD_PLAN.md`](../BUILD_PLAN.md) §9.
