###############################################################################
# Phase 10 Sprint 2.2 — Scheduled pg_dump task (ECS + EventBridge).
#
# Weekly Sunday 04:00 UTC, ECS runs `infra/backup-container/` against
# Fargate. The task pulls DATABASE_URL from Secrets Manager, runs
# `pg_dump`, uploads to the backup bucket, and emits a CloudWatch
# heartbeat metric the staleness alarm watches.
#
# The image is pushed to ECR out-of-band (see infra/backup-container/README
# or your normal CI/CD). The task references it by tag — bumping the tag
# requires a `terraform apply` to pick up.
###############################################################################

variable "backup_image" {
  type        = string
  description = "Full ECR image URI for the pg_dump container (e.g. <acct>.dkr.ecr.us-east-1.amazonaws.com/edi-hub-backup:2026-06)."
  default     = null
  nullable    = true
}

variable "backup_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs the backup task can run in (needs DB + S3 reachability)."
  default     = null
  nullable    = true
}

variable "backup_schedule_expression" {
  type        = string
  description = "EventBridge schedule expression. Default: every Sunday 04:00 UTC."
  default     = "cron(0 4 ? * SUN *)"
}

variable "backup_cluster_arn" {
  type        = string
  description = "ECS cluster ARN to run the scheduled task in (reuse the API cluster)."
  default     = null
  nullable    = true
}

# ─────────────────────────────────────────────────────────────
# IAM
# ─────────────────────────────────────────────────────────────

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Execution role — pulls the image, reads secrets, writes logs.
resource "aws_iam_role" "backup_task_execution" {
  count = var.enable_scheduled_backups ? 1 : 0
  name  = "edi-hub-backup-task-execution-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "backup_task_execution_basics" {
  count      = var.enable_scheduled_backups ? 1 : 0
  role       = aws_iam_role.backup_task_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "backup_task_execution_secrets" {
  count = var.enable_scheduled_backups ? 1 : 0
  role  = aws_iam_role.backup_task_execution[0].id
  name  = "read-database-url-secret"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.database_url.arn
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = aws_kms_key.secrets.arn
      },
    ]
  })
}

resource "aws_iam_role" "backup_task" {
  count = var.enable_scheduled_backups ? 1 : 0
  name  = "edi-hub-backup-task-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "backup_task_runtime" {
  count = var.enable_scheduled_backups ? 1 : 0
  role  = aws_iam_role.backup_task[0].id
  name  = "write-backups-and-heartbeat"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.backups[0].arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = { "cloudwatch:namespace" = "edi-hub" }
        }
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "backup_task" {
  count             = var.enable_scheduled_backups ? 1 : 0
  name              = "/edi-hub/${var.environment}/backup"
  retention_in_days = local.resolved_retention_days
}

resource "aws_ecs_task_definition" "backup" {
  count                    = var.enable_scheduled_backups ? 1 : 0
  family                   = "edi-hub-backup-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.backup_task_execution[0].arn
  task_role_arn            = aws_iam_role.backup_task[0].arn

  container_definitions = jsonencode([
    {
      name      = "backup"
      image     = var.backup_image
      essential = true

      environment = [
        { name = "BACKUP_BUCKET", value = aws_s3_bucket.backups[0].id },
        { name = "BACKUP_PREFIX", value = "edi-hub" },
        { name = "AWS_REGION", value = data.aws_region.current.name },
        { name = "ENVIRONMENT", value = var.environment },
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.backup_task[0].name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "backup"
        }
      }
    }
  ])
}

resource "aws_cloudwatch_event_rule" "backup_schedule" {
  count               = var.enable_scheduled_backups ? 1 : 0
  name                = "edi-hub-backup-${var.environment}"
  description         = "Weekly pg_dump backup trigger."
  schedule_expression = var.backup_schedule_expression
}

resource "aws_iam_role" "events_run_backup" {
  count = var.enable_scheduled_backups ? 1 : 0
  name  = "edi-hub-events-run-backup-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "events_run_backup" {
  count = var.enable_scheduled_backups ? 1 : 0
  role  = aws_iam_role.events_run_backup[0].id
  name  = "run-backup-task"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = aws_ecs_task_definition.backup[0].arn
      },
      {
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          aws_iam_role.backup_task_execution[0].arn,
          aws_iam_role.backup_task[0].arn,
        ]
      },
    ]
  })
}

resource "aws_cloudwatch_event_target" "backup_schedule" {
  count     = var.enable_scheduled_backups ? 1 : 0
  rule      = aws_cloudwatch_event_rule.backup_schedule[0].name
  target_id = "backup-task"
  arn       = var.backup_cluster_arn
  role_arn  = aws_iam_role.events_run_backup[0].arn

  ecs_target {
    launch_type         = "FARGATE"
    task_definition_arn = aws_ecs_task_definition.backup[0].arn
    platform_version    = "LATEST"

    network_configuration {
      subnets          = var.backup_subnet_ids
      security_groups  = var.db_allowed_security_group_ids
      assign_public_ip = false
    }
  }
}
