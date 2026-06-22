###############################################################################
# Phase 10 Sprint 1.4 — CloudWatch log group for the API task.
#
# The ECS task definition's `awslogs` log driver ships stdout/stderr here.
# Pino's structured JSON lines land as individual log events; CloudWatch
# Logs Insights queries like
#
#   fields @timestamp, tenantId, route, latencyMs
#   | filter route = '/lifecycle' and latencyMs > 500
#   | sort @timestamp desc
#
# work directly against them.
#
# Retention:
#   - prod: 90 days (long enough to investigate quarterly incidents).
#   - non-prod: 30 days.
# Override via the var.log_retention_days input.
###############################################################################

variable "log_retention_days" {
  description = "CloudWatch Logs retention in days. Defaults: 90 for prod, 30 elsewhere."
  type        = number
  default     = null
}

locals {
  resolved_retention_days = coalesce(
    var.log_retention_days,
    var.environment == "prod" ? 90 : 30,
  )
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/edi-hub/${var.environment}/api"
  retention_in_days = local.resolved_retention_days

  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
    Component   = "api"
  }
}

output "api_log_group_name" {
  value       = aws_cloudwatch_log_group.api.name
  description = "Pass to the ECS task definition's `awslogs-group` option."
}

output "api_log_group_arn" {
  value       = aws_cloudwatch_log_group.api.arn
  description = "Used by the task execution role's policy for logs:CreateLogStream + logs:PutLogEvents."
}
