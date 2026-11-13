output "proxy_endpoint" {
  description = "Customer-owned capture proxy invoke URL"
  value       = "${aws_apigatewayv2_api.proxy.api_endpoint}/decision-records"
}

output "proxy_function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.proxy.function_name
}

output "proxy_function_arn" {
  description = "Lambda function ARN"
  value       = aws_lambda_function.proxy.arn
}

output "capture_mode" {
  description = "Active capture policy mode"
  value       = trimspace(var.capture_policy_json) == "" ? "intent_only" : try(jsondecode(var.capture_policy_json).mode, "invalid-policy")
}

output "api_gateway_id" {
  description = "HTTP API Gateway ID"
  value       = aws_apigatewayv2_api.proxy.id
}

output "account_id" {
  description = "AWS account where proxy is deployed"
  value       = data.aws_caller_identity.current.account_id
}

output "region" {
  description = "AWS region where proxy is deployed"
  value       = data.aws_region.current.region
}

