# API container — build & push

Production image for ECS Fargate. Bundles the Fastify API and the Vite-built
React app (same-origin per ADR 0002).

## Build

From the **repo root**:

```bash
export VITE_CLERK_PUBLISHABLE_KEY=pk_test_...   # staging Clerk app

docker build \
  --build-arg VITE_CLERK_PUBLISHABLE_KEY="$VITE_CLERK_PUBLISHABLE_KEY" \
  -t edi-hub-api:local .
```

The build arg must match `clerk_publishable_key` in your Terraform tfvars — the
web bundle embeds it at compile time; the API reads it from env at boot.

## Push to ECR

After `terraform apply` creates the ECR repo (`api_ecr_repository_url` output):

```bash
AWS_REGION=us-east-1
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/edi-hub-api-staging"
TAG=$(date +%Y-%m-%d)-$(git rev-parse --short HEAD)

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

docker tag edi-hub-api:local "${ECR_URI}:${TAG}"
docker push "${ECR_URI}:${TAG}"
```

Set `api_image = "${ECR_URI}:${TAG}"` in `env/staging.tfvars`, then:

```bash
terraform apply -var-file=env/staging.tfvars
aws ecs update-service \
  --cluster edi-hub-staging \
  --service edi-hub-api-staging \
  --force-new-deployment
```

## Runtime behaviour

- **Entrypoint** runs `prisma migrate deploy` then `node dist/index.js`.
- **Secrets** (`DATABASE_URL`, Clerk keys) come from the ECS task `secrets`
  block — populate them in Secrets Manager before the first deploy.
- **Health:** ECS container health → `/health`; ALB target group → `/readiness`.

See [`../README.md`](../README.md) for the full staging apply order.
