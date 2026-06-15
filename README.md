# Obligra Verify — Terraform Capture Proxy

> **Status: Early Preview** — This module is under active development. APIs and behavior may change.

## What This Is

A **customer-owned capture boundary** — a serverless proxy that runs in your AWS account and controls what AI decision data becomes a retained record in Obligra Verify.

Verify is not a surveillance logger. You own the proxy. You own the policy. You decide what becomes a retained decision record. Policy evaluation occurs before data leaves your AWS account.

## Architecture

```
Customer Application
       │
       ▼
Customer-Owned API Gateway (your account)
       │
       ▼
Customer-Owned Lambda Capture Proxy (your account)
       │
       ▼
┌─────────────────────────────────────┐
│       Capture Policy Engine         │
│                                     │
│  Capture Decision Policy            │
│  (forward_all / intent_only /policy)│
│                                     │
│  Field Retention Policy             │
│  (allow / drop / redact / truncate) │
│                                     │
│  security.neverForward              │
│  (hard block — never leaves account)│
└─────────────────────────────────────┘
       │
       ▼  approved fields only
Obligra Verify API (Obligra-managed)
       │
       ▼
Decision Record (signed + stored)
       │
       ▼
Verify Console (retrieval + verification + audit)
```

**Key principle**: The red boundary — the Capture Policy Engine — is the security and governance control point. Only fields that pass your policy reach Verify. Dropped and redacted fields never leave your AWS account.

## Resources Created

| Resource | Purpose |
|----------|---------|
| Lambda Function | Capture proxy with policy engine |
| API Gateway (HTTP) | Invoke endpoint for your applications |
| IAM Role + Policy | Least-privilege (CloudWatch logs only) |
| CloudWatch Log Group | Structured operational logs (no sensitive data) |

## Customer-Owned Capture Policy

The capture policy is a first-class architectural component, not an implementation detail.

| Concern | How the Policy Addresses It |
|---------|----------------------------|
| Data governance | You explicitly declare what is retained vs dropped |
| Compliance auditability | Policy JSON is reviewable by compliance without reading code |
| Security boundary | Data physically cannot leave your account without passing through your policy |
| Trust model | You enforce your own rules — no need to trust Verify to drop fields |
| Explicit intent | Verify receives only what you consciously chose to send |

## Capture Decision Policy

The capture decision policy determines *whether* a request becomes a retained record.

| Mode | Behavior | Use Case |
|------|----------|----------|
| `forward_all` | Forwards all eligible requests | Sandbox, dev, testing |
| `intent_only` | Only workflowId + model metadata — no prompt/response/context | Application-controlled capture intent |
| `policy` | Proxy evaluates field rules before forwarding | Production, governance, enterprise |

## Field Retention Policy

When a request *is* captured, the field retention policy controls which fields are allowed to leave your account.

| Action | Behavior |
|--------|----------|
| `allow` | Field is forwarded to Verify |
| `drop` | Field is silently removed — never leaves the account |
| `redact` | Field name is preserved but value is removed |
| `truncate` | Field value is cut to `maxLength` characters |
| `neverForward` | Hard security block — field is always dropped regardless of other rules |

## Policy Example

```json
{
  "mode": "policy",
  "capture": {
    "operationalContext": {
      "allowedKeys": [
        "ticketId",
        "customerId",
        "severity",
        "environment"
      ],
      "dropUnknownKeys": true,
      "maxValueLength": 512
    },
    "prompt": {
      "allow": true,
      "maxLength": 500
    },
    "response": {
      "allow": true,
      "maxLength": 500
    },
    "model": {
      "includeProvider": true,
      "includeModelId": true
    }
  },
  "security": {
    "neverForward": [
      "authToken",
      "customerSSN",
      "internalNotes",
      "debugTrace",
      "rawPayload"
    ],
    "logRedactions": true
  }
}
```

## Policy Evaluation Example

Given an input with these fields:

| Input Field | Policy Action | Result |
|-------------|---------------|--------|
| `ticketId` | allow | ✅ Forwarded |
| `customerId` | allow | ✅ Forwarded |
| `severity` | allow | ✅ Forwarded |
| `environment` | allow | ✅ Forwarded |
| `prompt` | allow (max 500 chars) | ✅ Forwarded |
| `response` | allow (max 500 chars) | ✅ Forwarded |
| `authToken` | neverForward | ❌ Dropped |
| `customerSSN` | neverForward | ❌ Dropped |
| `internalNotes` | neverForward | ❌ Dropped |
| `debugTrace` | neverForward | ❌ Dropped |
| `rawPayload` | neverForward | ❌ Dropped |

Only the approved fields reach the Verify API. Dropped fields never leave the customer AWS account.

## Prerequisites

- Terraform >= 1.5
- AWS CLI configured with a profile that has permissions to create Lambda, API Gateway, IAM, and CloudWatch resources
- An Obligra Verify API key (obtain from the Verify Console)

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

# 2. Create a .tfvars file (gitignored — never commit this file)
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
      "severity": "medium",
      "environment": "production",
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

## Security & Logging

### Secrets Handling
- **Terraform**: `verify_api_key` is declared `sensitive = true` — never shown in plan output or state diffs
- **State files**: Contain the key value — never commit `*.tfstate` to version control
- **terraform.tfvars**: Contains the key — never commit (gitignored by default)

### What Is Logged (safe metadata only)
- Timestamp, service name, request ID
- Workflow ID (not payload)
- Policy mode, HTTP status code, duration
- Dropped/redacted field counts (not field values)

### What Is Never Logged
- API keys
- Prompts or responses
- Dropped or redacted field values
- Auth tokens
- Customer PII
- Raw payloads

### IAM
- Least-privilege: the Lambda role can only write to its own CloudWatch log group
- No DynamoDB, S3, KMS, or other service access
- No network access beyond HTTPS egress to the Verify API

### Data Boundary
- The capture policy is applied *before* any data leaves your AWS account
- You own the Lambda, the API Gateway, and the policy
- Obligra has no access to your account, your VPC, or your data at rest

## Cleanup

```bash
terraform destroy
```

Removes all resources. No orphaned resources remain.

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
