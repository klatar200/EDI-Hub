###############################################################################
# Phase 10 Sprint A1 — ECS Fargate service for the API + web bundle.
#
# Same-origin deploy per ADR 0002: the container serves React static files from
# WEB_STATIC_DIR and API routes under /api/*. The ALB forwards HTTPS to this
# task; health checks hit /readiness (see alb.tf).
#
# Image flow:
#   1. `docker build` (repo-root Dockerfile) → push to the ECR repo here.
#   2. Set `api_image` in env/<env>.tfvars to the pushed URI (tagged, not :latest).
#   3. `terraform apply` picks up the task definition; ECS rolls the service.
#
# Secrets (DATABASE_URL, Clerk keys) resolve via the task execution role and
# the ECS `secrets` block — plaintext env at container start, no SM_PREFIX SDK
# path required at runtime.
###############################################################################

variable "api_image" {
  type        = string
  description = "Full ECR image URI for the API container (e.g. <acct>.dkr.ecr.us-east-1.amazonaws.com/edi-hub-api-staging:2026-06-25)."
}

variable "api_subnet_ids" {
  type        = list(string)
  description = "Subnet IDs for the API task ENI. Defaults to public_subnet_ids (Fargate needs a route to ECR/S3/RDS)."
  default     = null
}

variable "api_desired_count" {
  type        = number
  description = "Number of API tasks behind the ALB."
  default     = 1
}

variable "api_cpu" {
  type        = number
  description = "Fargate CPU units (256, 512, 1024, …)."
  default     = 512
}

variable "api_memory" {
  type        = number
  description = "Fargate memory (MiB)."
  default     = 1024
}

variable "api_assign_public_ip" {
  type        = bool
  description = "Assign a public IP to the task ENI. true when api_subnet_ids are public subnets without NAT."
  default     = true
}

variable "clerk_publishable_key" {
  type        = string
  description = "Clerk pk_test/pk_live — baked into the web build at docker build time and passed to the API at runtime."
}

locals {
  api_subnet_ids = coalesce(var.api_subnet_ids, var.public_subnet_ids)
  clerk_authorized_parties = "https://${var.public_domain}"
}

data "aws_caller_identity" "ecs" {}
data "aws_region" "ecs" {}

resource "aws_ecr_repository" "api" {
  name                 = "edi-hub-api-${var.environment}"
  image_tag_mutability = "MUTABLE"
  force_delete         = var.environment != "prod"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
  }
}

resource "aws_ecs_cluster" "main" {
  name = "edi-hub-${var.environment}"

  setting {
    name  = "containerInsights"
    value = var.environment == "prod" ? "enabled" : "disabled"
  }

  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
  }
}

# Task security group — ALB → API on the configured port; API → RDS/S3 via egress.
resource "aws_security_group" "api_task" {
  name        = "edi-hub-api-task-${var.environment}"
  description = "Fargate API task — ingress from ALB only."
  vpc_id      = var.vpc_id

  egress {
    description = "All outbound (RDS, S3, Secrets Manager, ECR)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
  }
}

resource "aws_security_group_rule" "api_ingress_from_alb" {
  type                     = "ingress"
  from_port                = var.api_target_port
  to_port                  = var.api_target_port
  protocol                 = "tcp"
  security_group_id        = aws_security_group.api_task.id
  source_security_group_id = aws_security_group.alb.id
  description              = "HTTPS-terminated traffic from ALB."
}

resource "aws_security_group_rule" "db_ingress_from_api" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.edi_db.id
  source_security_group_id = aws_security_group.api_task.id
  description              = "Postgres from API Fargate task."
}

# ─────────────────────────────────────────────────────────────
# IAM — execution role (image pull, logs, secrets) + task role (S3)
# ─────────────────────────────────────────────────────────────

resource "aws_iam_role" "api_task_execution" {
  name = "edi-hub-api-task-execution-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "api_task_execution_basics" {
  role       = aws_iam_role.api_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "api_task_execution_secrets" {
  role = aws_iam_role.api_task_execution.id
  name = "read-app-secrets"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          aws_secretsmanager_secret.database_url.arn,
          aws_secretsmanager_secret.clerk_secret_key.arn,
          aws_secretsmanager_secret.clerk_webhook_secret.arn,
          aws_secretsmanager_secret.global_slack_webhook.arn,
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = aws_kms_key.secrets.arn
      },
    ]
  })
}

resource "aws_iam_role" "api_task" {
  name = "edi-hub-api-task-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "api_task_ingestion" {
  role       = aws_iam_role.api_task.name
  policy_arn = aws_iam_policy.ingestion.arn
}

resource "aws_ecs_task_definition" "api" {
  family                   = "edi-hub-api-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = tostring(var.api_cpu)
  memory                   = tostring(var.api_memory)
  execution_role_arn       = aws_iam_role.api_task_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.api_image
      essential = true

      portMappings = [
        { containerPort = var.api_target_port, hostPort = var.api_target_port, protocol = "tcp" }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = tostring(var.api_target_port) },
        { name = "S3_BUCKET", value = aws_s3_bucket.raw_files.id },
        { name = "S3_REGION", value = data.aws_region.ecs.name },
        { name = "WEB_STATIC_DIR", value = "/app/apps/web/dist" },
        { name = "JOB_BACKEND", value = "db" },
        { name = "NOTIFIER_MODE", value = "preview" },
        { name = "VITE_CLERK_PUBLISHABLE_KEY", value = var.clerk_publishable_key },
        { name = "CLERK_AUTHORIZED_PARTIES", value = local.clerk_authorized_parties },
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = "CLERK_SECRET_KEY", valueFrom = aws_secretsmanager_secret.clerk_secret_key.arn },
        { name = "CLERK_WEBHOOK_SECRET", valueFrom = aws_secretsmanager_secret.clerk_webhook_secret.arn },
        { name = "GLOBAL_SLACK_WEBHOOK", valueFrom = aws_secretsmanager_secret.global_slack_webhook.arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = data.aws_region.ecs.name
          awslogs-stream-prefix = "api"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:${var.api_target_port}/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
  }
}

resource "aws_ecs_service" "api" {
  name            = "edi-hub-api-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = local.api_subnet_ids
    security_groups  = [aws_security_group.api_task.id]
    assign_public_ip = var.api_assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = var.api_target_port
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # New task definitions roll out when terraform apply updates the family.
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener.https]

  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
  }
}

output "api_ecr_repository_url" {
  value       = aws_ecr_repository.api.repository_url
  description = "Push the Dockerfile-built image here before setting api_image."
}

output "api_ecs_cluster_arn" {
  value       = aws_ecs_cluster.main.arn
  description = "Reuse for scheduled backup tasks (backup_cluster_arn in tfvars)."
}

output "api_ecs_cluster_name" {
  value       = aws_ecs_cluster.main.name
  description = "Cluster name for aws ecs update-service / run-task."
}

output "api_ecs_service_name" {
  value       = aws_ecs_service.api.name
  description = "Service name for force-new-deployment after image push."
}

output "api_task_security_group_id" {
  value       = aws_security_group.api_task.id
  description = "API task SG — RDS ingress is wired automatically in this module."
}
