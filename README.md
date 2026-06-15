# Obligra Verify — Terraform Capture Proxy

> **Status: Early Preview** — This module is under active development. APIs and behavior may change.

## What This Deploys

A customer-owned serverless capture proxy that relays AI decision records to the Obligra Verify API. The proxy runs entirely within your AWS account — no Obligra infrastructure touches your VPC or data at rest.

**Resources created:**

| Resource | Purpose |
|----------|---------|
| Lambda Function | Capture proxy with policy engine |
| API Gateway (HTTP) | Public invoke endpoint |
| IAM Role + Policy | Least-privilege (CloudWatch logs only) |
| CloudWatch Log Group | Structured logs (no sensitive data) |

## Architecture

```
Your Application
    │
    ▼
API Gateway (your account)
    │
    ▼
Lambda Capture Proxy (your account)
    │ ← capture policy applied here
    ▼
Obligra Verify API (Obligra account)
    │
    ▼
Decision Record stored + signed
```

## Prerequisites

- Terraform >= 1.5
- AWS CLI configured with a profile that has permissions to create Lambda, API Gateway, IAM, and CloudWatch resources
- An Obligra Verify API key (obtain from your Obligra dashboard)

## Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `aws_region` | No | `us-west-2` | AWS region for deployment |
| `aws_profile` | No | — | AWS CLI profile to use |
| `environment_name` | No | `sandbox` | Environment label (sandbox/dev/staging/production) |
| `verify_api_base_url` | No | Preview URL | Obligra Verify API base URL |
| `verify_api_key` | **Yes** | — | Obligra Verify API key (sensitive, never logged) |
| `capture_policy_json` | No | `""` (forward_all) | JSON capture policy |
| `allowed_origins` | No | `*` | CORS allowed origins |
| `log_retention_days` | No | `14` | CloudWatch log retention |

## Deploy

```bash
# 1. Initialize
terraform init

# 2. Create a .tfvars file (gitignored)
cat > terraform.tfvars <<EOF
aws_profile     = "your-profile"
aws_region      = "us-west-2"
verify_api_key  = "obv_..."
EOF

# 3. Plan
terraform plan

# 4. Apply
terraform apply
```

## Invoke Example

```bash
curl -X POST \
  "$(terraform output -raw proxy_endpoint)" \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "my-workflow",
    "model": { "provider": "anthropic", "modelId": "claude-sonnet-4-20250514" },
    "operationalContext": {
      "ticketId": "TICKET-001",
      "prompt": "Summarize this request.",
      "response": "The request has been summarized."
    }
  }'
```

Expected response (HTTP 201):
```json
{
  "decisionRecordId": "dr_...",
  "status": "recorded",
  "verificationState": "not_verified"
}
```

## Capture Policy

The capture policy controls what data leaves your account. Three modes:

| Mode | Behavior |
|------|----------|
| `forward_all` | Pass-through (default if no policy set) |
| `intent_only` | Only workflowId + model metadata |
| `policy` | Explicit field allow/drop/redact rules |

Example policy:
```json
{
  "mode": "policy",
  "capture": {
    "operationalContext": {
      "allowedKeys": ["ticketId", "severity", "environment"],
      "dropUnknownKeys": true
    },
    "prompt": { "allow": true, "maxLength": 256 },
    "response": { "allow": true, "maxLength": 256 }
  },
  "security": {
    "neverForward": ["ssn", "creditCard", "internalNotes"]
  }
}
```

## Security & Logging

- **API key**: Stored as a Lambda environment variable (encrypted at rest via AWS Lambda service key). Never logged, never output.
- **Logs contain only**: timestamp, service name, request ID, workflow ID, policy mode, HTTP status, duration, dropped/redacted field counts.
- **Logs never contain**: payloads, prompts, responses, API keys, auth tokens, customer PII, or field values.
- **IAM**: Least-privilege — the Lambda role can only write to its own CloudWatch log group. No DynamoDB, S3, or network access beyond HTTPS egress.
- **Data boundary**: The capture policy is applied *before* any data leaves your account.

## Cleanup

```bash
terraform destroy
```

This removes all resources created by this module. No orphaned resources.

## Outputs

| Output | Description |
|--------|-------------|
| `proxy_endpoint` | Invoke URL for the capture proxy |
| `proxy_function_name` | Lambda function name |
| `proxy_function_arn` | Lambda function ARN |
| `capture_mode` | Active policy mode |
| `api_gateway_id` | HTTP API ID |
| `account_id` | AWS account ID |
| `region` | Deployment region |

No secrets or sensitive values are included in outputs.
