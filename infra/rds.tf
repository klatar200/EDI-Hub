###############################################################################
# Phase 9 Sprint 5 — Encrypted Postgres (RDS).
#
# Storage encrypted at rest with the AWS-managed key (KMS alias/aws/rds).
# rds.force_ssl=1 forces clients to connect over TLS; the API config builds
# its DATABASE_URL with sslmode=require to match. Backups inherit the same
# encryption setting because they share the source storage's KMS key.
#
# The instance lives in a private subnet group; only the API task's security
# group is allowed inbound on 5432. There is no public endpoint.
#
# Existing-instance migration path: snapshot the current unencrypted RDS,
# restore the snapshot with `--kms-key-id`, then swap connection strings.
# See `infra/README.md` for the runbook.
###############################################################################

# DB credentials are sourced from Secrets Manager (Sprint 4 secrets.tf).
# The DATABASE_URL secret embeds them so the application never sees them
# in env vars — only the secrets-loader does, and only at boot.

variable "db_name" {
  type        = string
  description = "Logical database name (e.g. edi_hub)."
  default     = "edi_hub"
}

variable "db_master_username" {
  type        = string
  description = "Master username for the RDS instance."
  default     = "edi_admin"
}

variable "db_master_password" {
  type        = string
  description = "Master password. Provide via -var-file or TF_VAR_db_master_password; never commit."
  sensitive   = true
}

variable "db_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs the DB subnet group should span (2+ AZs)."
}

variable "db_allowed_security_group_ids" {
  type        = list(string)
  description = "Security group IDs allowed inbound on 5432 (typically the API task SG)."
  default     = []
}

variable "vpc_id" {
  type        = string
  description = "VPC ID hosting the DB and its security group."
}

variable "db_instance_class" {
  type        = string
  description = "RDS instance class. Right-size per environment."
  default     = "db.t4g.small"
}

resource "aws_db_subnet_group" "edi" {
  name       = "edi-hub-${var.environment}"
  subnet_ids = var.db_subnet_ids
  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
  }
}

resource "aws_security_group" "edi_db" {
  name        = "edi-hub-db-${var.environment}"
  description = "Inbound Postgres for the EDI API task only."
  vpc_id      = var.vpc_id

  egress {
    description = "Allow all egress — RDS originates none in practice."
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

# Per-source rules — one per allowed app SG. Using `aws_security_group_rule`
# rather than an inline ingress block keeps multi-app fan-out clean.
resource "aws_security_group_rule" "db_ingress_app" {
  for_each                 = toset(var.db_allowed_security_group_ids)
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.edi_db.id
  source_security_group_id = each.value
  description              = "Postgres from allowed app SG."
}

# Force-SSL parameter group. rds.force_ssl=1 makes the server reject any
# non-TLS connection — the API's DATABASE_URL must include sslmode=require.
resource "aws_db_parameter_group" "edi" {
  name        = "edi-hub-${var.environment}"
  family      = "postgres16"
  description = "EDI Hub Postgres params — force TLS."

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "aws_db_instance" "edi" {
  identifier     = "edi-hub-${var.environment}"
  engine         = "postgres"
  engine_version = "16.4"
  instance_class = var.db_instance_class

  # Storage + encryption — the entire point of this sprint.
  allocated_storage     = 50
  max_allocated_storage = 500
  storage_type          = "gp3"
  storage_encrypted     = true
  # No `kms_key_id` → AWS uses the regional default RDS managed key.

  db_name  = var.db_name
  username = var.db_master_username
  password = var.db_master_password
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.edi.name
  vpc_security_group_ids = [aws_security_group.edi_db.id]
  parameter_group_name   = aws_db_parameter_group.edi.name
  publicly_accessible    = false

  # Backups also live on the encrypted storage's KMS key.
  backup_retention_period = 14
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:30-sun:05:30"
  copy_tags_to_snapshot   = true
  deletion_protection     = true
  skip_final_snapshot     = false
  final_snapshot_identifier = "edi-hub-${var.environment}-final"

  # Performance Insights is encrypted with the same key set; turning it on
  # is cheap insurance for incident debugging.
  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
  }
}

output "db_endpoint" {
  value       = aws_db_instance.edi.endpoint
  description = "host:port — combine with the DATABASE_URL secret to form the full connection string."
}

output "db_security_group_id" {
  value       = aws_security_group.edi_db.id
  description = "Attach the API task SG to db_allowed_security_group_ids."
}
