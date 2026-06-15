terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  function_name = "verify-capture-proxy-${var.environment_name}"
  log_group     = "/aws/lambda/${local.function_name}"
}

# ─── IAM Role ──────────────────────────────────────────────────────────────────

resource "aws_iam_role" "proxy_lambda" {
  name = "${local.function_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "proxy_logs" {
  name = "CloudWatchLogsOnly"
  role = aws_iam_role.proxy_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
      Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:${local.log_group}:*"
    }]
  })
}

# ─── CloudWatch Log Group ──────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "proxy" {
  name              = local.log_group
  retention_in_days = var.log_retention_days
}

# ─── Lambda Function ───────────────────────────────────────────────────────────

data "archive_file" "proxy_lambda" {
  type        = "zip"
  source_file = "${path.module}/lambda/index.mjs"
  output_path = "${path.module}/.build/proxy.zip"
}

resource "aws_lambda_function" "proxy" {
  function_name    = local.function_name
  role             = aws_iam_role.proxy_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  memory_size      = 128
  timeout          = 15
  filename         = data.archive_file.proxy_lambda.output_path
  source_code_hash = data.archive_file.proxy_lambda.output_base64sha256

  environment {
    variables = {
      VERIFY_API_BASE_URL = var.verify_api_base_url
      VERIFY_API_KEY      = var.verify_api_key
      ENVIRONMENT_NAME    = var.environment_name
      ALLOWED_ORIGINS     = var.allowed_origins
      CAPTURE_POLICY_JSON = var.capture_policy_json
    }
  }

  depends_on = [
    aws_iam_role_policy.proxy_logs,
    aws_cloudwatch_log_group.proxy
  ]
}

# ─── API Gateway (HTTP API) ────────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "proxy" {
  name          = "verify-capture-proxy-${var.environment_name}"
  protocol_type = "HTTP"
  description   = "Customer-owned Verify capture proxy with capture policy engine"
}

resource "aws_apigatewayv2_integration" "proxy" {
  api_id                 = aws_apigatewayv2_api.proxy.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.proxy.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "post" {
  api_id    = aws_apigatewayv2_api.proxy.id
  route_key = "POST /decision-records"
  target    = "integrations/${aws_apigatewayv2_integration.proxy.id}"
}

resource "aws_apigatewayv2_route" "options" {
  api_id    = aws_apigatewayv2_api.proxy.id
  route_key = "OPTIONS /decision-records"
  target    = "integrations/${aws_apigatewayv2_integration.proxy.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.proxy.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  function_name = aws_lambda_function.proxy.function_name
  action        = "lambda:InvokeFunction"
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.proxy.execution_arn}/*"
}
