###############################################################################
# Phase 9 Sprint 5 — TLS at the edge.
#
# Public clients hit an ALB on 443. The HTTPS listener terminates TLS using
# an ACM-issued certificate; the HTTP:80 listener does nothing but redirect
# to HTTPS. There is no plaintext path into the API.
#
# The ACM cert is DNS-validated; the apex `var.public_domain` (e.g.
# api.edihub.example.com) must have its NS records pointing at the
# Route53 zone provided in `var.route53_zone_id`.
#
# The Fastify app adds the `Strict-Transport-Security` header on every
# response (see apps/api/src/plugins/security-headers.ts), so once a client
# has connected over HTTPS the browser refuses any future HTTP attempt.
###############################################################################

variable "public_domain" {
  type        = string
  description = "Public FQDN for the API (e.g. api.edihub.example.com)."
}

variable "route53_zone_id" {
  type        = string
  description = "Route 53 hosted-zone id that owns var.public_domain."
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Public subnet IDs for the ALB (2+ AZs)."
}

variable "api_target_port" {
  type        = number
  description = "Port the API task listens on inside the VPC."
  default     = 3000
}

# ACM certificate with DNS validation.
resource "aws_acm_certificate" "api" {
  domain_name       = var.public_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
  }
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }
  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for r in aws_route53_record.api_cert_validation : r.fqdn]
}

# ALB security group: 80 + 443 in, all out.
resource "aws_security_group" "alb" {
  name        = "edi-hub-alb-${var.environment}"
  description = "Public ingress to the EDI API ALB."
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP (redirected to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
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

resource "aws_lb" "api" {
  name                       = "edi-hub-${var.environment}"
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = var.public_subnet_ids
  drop_invalid_header_fields = true
  enable_http2               = true

  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
  }
}

resource "aws_lb_target_group" "api" {
  name        = "edi-hub-${var.environment}"
  port        = var.api_target_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id

  health_check {
    path                = "/readiness"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }

  tags = {
    Project     = "edi-data-hub"
    Environment = var.environment
  }
}

# HTTPS listener — modern TLS policy only.
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# SEC-H4 — block /internal/* on the public listener. The app treats
# /internal/metrics as unauthenticated for cheap Prometheus scrapes, but
# that endpoint must not be reachable from the internet. Scrapers run inside
# the VPC (direct task IP, private NLB, or security-group-scoped access).
resource "aws_lb_listener_rule" "block_internal_paths" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 1

  action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }

  condition {
    path_pattern {
      values = ["/internal/*"]
    }
  }
}

# HTTP listener: redirect everything to HTTPS.
resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# DNS: point the public FQDN at the ALB.
resource "aws_route53_record" "api_alias" {
  zone_id = var.route53_zone_id
  name    = var.public_domain
  type    = "A"

  alias {
    name                   = aws_lb.api.dns_name
    zone_id                = aws_lb.api.zone_id
    evaluate_target_health = true
  }
}

output "api_alb_dns" {
  value       = aws_lb.api.dns_name
  description = "The ALB's AWS-assigned DNS name (the Route 53 ALIAS points here)."
}

output "api_target_group_arn" {
  value       = aws_lb_target_group.api.arn
  description = "Attach the API ECS service to this target group."
}

output "api_public_url" {
  value       = "https://${var.public_domain}"
  description = "External entrypoint for the API."
}
