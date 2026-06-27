###############################################################################
# Phase 10 Sprint 2.3 — CloudWatch alarms.
#
# Single SNS topic fans out to the on-call Slack webhook (the URL itself
# lives in Secrets Manager — see secrets.tf). Each alarm routes here.
#
# Today: just the backup-stale alarm. Future sprints land:
#   - Retention-worker last-run-stale (Sprint 3).
#   - Rate-limit flood (Sprint 4).
#   - 5xx error-rate breach (Sprint 5 + load test).
###############################################################################

resource "aws_sns_topic" "oncall" {
  name = "edi-hub-oncall-${var.environment}"
  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
    Purpose     = "oncall-alerts"
  }
}

# The Slack chatbot / webhook subscriber is configured out-of-band — see
# ops/RUNBOOKS.md "Setting up SNS → Slack" for the manual one-time wiring.
# We deliberately don't `aws_sns_topic_subscription` here so a secret-rotation
# in the webhook URL doesn't require a `terraform apply`.

# ─────────────────────────────────────────────────────────────
# Backup heartbeat alarm.
#
# The pg_dump task publishes `edi-hub/BackupSuccess` (value=1) on each
# successful run. We alarm when the count is < 1 across a 10-day window —
# i.e. the weekly job missed at least one cycle. Treating missing data as
# breaching is important here: "no metric at all" is the failure mode we
# care about most (cluster paused, schedule disabled, task crashing).
# ─────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "backup_stale" {
  count               = var.enable_scheduled_backups ? 1 : 0
  alarm_name          = "edi-hub-backup-stale-${var.environment}"
  alarm_description   = "Weekly pg_dump has not succeeded in the last 10 days. See ops/RUNBOOKS.md#backup-stale."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BackupSuccess"
  namespace           = "edi-hub"
  period              = 60 * 60 * 24 * 10 # 10 days
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "breaching"

  dimensions = {
    Environment = var.environment
  }

  alarm_actions = [aws_sns_topic.oncall.arn]
  ok_actions    = [aws_sns_topic.oncall.arn]
}

output "oncall_sns_topic_arn" {
  value       = aws_sns_topic.oncall.arn
  description = "SNS topic ARN — subscribe the Slack webhook (or PagerDuty) to this once per environment."
}
