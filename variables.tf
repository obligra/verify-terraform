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
  default     = "https://api.obligra.ai"
  description = "Obligra Verify API base URL"
}

variable "verify_api_key" {
  type        = string
  sensitive   = true
  description = "Obligra Verify API key. Never logged or output."
}

variable "capture_policy_json" {
  type        = string
  default     = "{\"mode\":\"intent_only\"}"
  description = "JSON capture policy. Empty uses intent_only; invalid policy is rejected."
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

