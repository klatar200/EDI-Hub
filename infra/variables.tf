# Shared Terraform toggles

variable "enable_scheduled_backups" {
  type        = bool
  description = "When false, skip logical backup buckets and the weekly pg_dump ECS task (Sprint A1 staging bootstrap)."
  default     = false
}
