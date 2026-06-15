variable "aws_region" {
  type        = string
  default     = "us-west-2"
  description = "AWS region for deployment"
}

variable "aws_profile" {
  type        = string
  default     = "obligra-customer-test"
  description = "AWS CLI profile to use"
}

variable "environment_name" {
  type        = string
  default     = "sandbox"
  description = "Environment label (sandbox, dev, staging, production)"

  validation {
    condition     = contains(["sandbox", "dev", "staging", "production"], var.environment_name)
    error_message = "Must be one of: sandbox, dev, staging, production"
  }
}

variable "verify_api_base_url" {
  type        = string
  default     = "https://y1h3onv0f1.execute-api.us-east-1.amazonaws.com/dev"
  description = "Obligra Verify API base URL"
}

variable "verify_api_key" {
  type        = string
  sensitive   = true
  description = "Obligra Verify API key. Never logged or output."
}

variable "capture_policy_json" {
  type        = string
  default     = ""
  description = "JSON capture policy. Empty = forward_all mode."
}

variable "allowed_origins" {
  type        = string
  default     = "*"
  description = "Comma-separated CORS origins. Use '*' for dev only."
}

variable "log_retention_days" {
  type        = number
  default     = 14
  description = "CloudWatch log retention in days"

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90], var.log_retention_days)
    error_message = "Must be one of: 1, 3, 5, 7, 14, 30, 60, 90"
  }
}
