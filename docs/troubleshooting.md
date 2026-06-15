# Troubleshooting Verify Integrations

This guide covers common deployment, validation, and integration issues for the Obligra Verify capture proxy.

---

## Before You Troubleshoot

Before investigating any issue, confirm these basics:

| Check | How |
|-------|-----|
| Correct AWS account | `aws sts get-caller-identity` |
| Correct Verify environment | Check `verify_api_base_url` in your config |
| API key is valid | Not revoked, not expired, full key (prefix + secret) |
| Workspace matches | Same workspace as your console login |
| `decisionRecordId` was returned | Check the HTTP 201 response body |
| Correct API endpoint | Preview URL vs production URL |

---

## Record Never Appears in Verify

**Symptoms:**
- HTTP 201 returned from the proxy
- `decisionRecordId` returned in the response
- Record not visible in the Verify Console

**Possible causes:**

| Cause | Resolution |
|-------|-----------|
| Wrong environment | Confirm `verify_api_base_url` points to the correct Verify environment |
| Wrong workspace | Your console user may be viewing a different workspace than the API key's workspace |
| Wrong user/tenant | The API key belongs to a specific tenant — ensure your console login is the same tenant |
| Policy skipped the record | Check if `capture_policy_json` has rules that would filter the payload |
| API base URL mismatch | Preview URL and production URL are different environments with separate databases |

**Resolution steps:**
1. Copy the `decisionRecordId` from the proxy response
2. Log into the Verify Console with the same account that owns the API key
3. Search by `decisionRecordId` directly
4. If not found, verify the API base URL matches your console environment

---

## Record Appears But Search Fails

**Check these fields:**
- `decisionRecordId` — exact ID from the capture response
- `workflowId` — must match what was sent in the payload
- Retrieval keys — search uses these for filtering
- Environment filter — console may be filtering by environment
- User scope — your user must belong to the same tenant/workspace

---

## Invalid API Key

**Symptoms:**
- HTTP 401 from the Verify API
- Proxy logs show `statusCode: 401`

**Common causes:**

| Cause | Fix |
|-------|-----|
| Revoked key | Generate a new key in the Verify Console |
| Copied prefix only | The full key format is `obv_{prefix}.{secret}` — both parts are required |
| Wrong environment | Keys are environment-specific — a dev key won't work against production |
| Whitespace | Ensure no leading/trailing spaces in your tfvars or environment variable |
| Expired or rotated | Check key status in the Verify Console |

---

## Lost API Key Secret

The API key secret is displayed **once** at creation time. It cannot be retrieved again.

**Resolution:**
1. Generate a new API key in the Verify Console
2. Update the key in your `terraform.tfvars` (or secrets store)
3. Run `terraform apply` to update the Lambda environment variable
4. Revoke the old key in the Verify Console

---

## Capture Policy Skipped Record

**Symptoms:**
- Proxy returns a response but with unexpected content
- Record is missing fields or not created

**Possible causes:**

| Cause | Resolution |
|-------|-----------|
| `mode: intent_only` active | Only workflowId + model metadata are forwarded — no operational context |
| Required field `workflowId` missing | Every capture request must include `workflowId` |
| Invalid policy JSON | Check for JSON syntax errors in `capture_policy_json` |
| Policy not loaded | Check CloudWatch logs for `policy_parse_error` |

**Debug steps:**
1. Check CloudWatch logs for `policy_applied` events — they show `droppedFields` count
2. Temporarily switch to `forward_all` mode to confirm the issue is policy-related
3. Validate your policy JSON with a JSON linter before deploying

---

## Field Missing From Decision Record

If specific fields don't appear in the retained record, they were likely filtered by your Field Retention Policy.

**Fields may be:**

| Action | What happened |
|--------|--------------|
| Dropped | Field was in `security.neverForward` or not in `allowedKeys` with `dropUnknownKeys: true` |
| Redacted | Field was in `redactedKeys` — name preserved but value removed |
| Truncated | Field exceeded `maxValueLength` or `maxLength` — value was cut |

**This is expected behavior.** The capture policy is working as designed — these fields never left your AWS account.

**To include a field:** Add it to `capture.operationalContext.allowedKeys` in your policy JSON.

---

## Wrong AWS Account Deployment

**Always verify before any deployment:**

```bash
aws sts get-caller-identity --profile your-profile
```

Confirm the `Account` field matches your intended target.

**Risk:** Deploying to the wrong account creates orphaned resources, may expose your API key to unintended environments, and creates confusion about where captured records are being forwarded from.

**Before every:**
- `terraform plan`
- `terraform apply`
- `terraform destroy`

Run the identity check first.

---

## Terraform Issues

### terraform fmt / init / validate fail

| Issue | Resolution |
|-------|-----------|
| `fmt` reports changes | Run `terraform fmt` and commit the formatted files |
| `init` fails | Check internet connectivity and provider registry access |
| `validate` fails | Check variable types, required fields, and HCL syntax |

### terraform plan shows unexpected changes

- Confirm you're using the correct `.tfvars` file
- Confirm state file hasn't been corrupted or manually edited
- Run `terraform refresh` if cloud resources were modified outside Terraform

### Sensitive variable warnings

Ensure `verify_api_key` is declared with `sensitive = true` (already done in the module).

**Never commit:**
- `terraform.tfvars` (contains your API key)
- `*.tfstate` (contains resource details including environment variables)
- `.terraform/` (provider binaries)

---

## CloudWatch Logs Look Empty

**Check:**

| Step | Command |
|------|---------|
| Lambda was invoked | Check API Gateway access logs or Lambda invocation metrics |
| Lambda has log permissions | IAM role must have `logs:CreateLogStream` and `logs:PutLogEvents` |
| Correct log group | `/aws/lambda/verify-capture-proxy-{environment_name}` |
| API Gateway route exists | Confirm `POST /decision-records` route is deployed |
| Stage is deployed | Confirm the `$default` stage has auto-deploy enabled |

**Common cause:** The request never reached the Lambda — check that you're calling the correct endpoint URL.

---

## Verification Issues

**Symptoms:**
- "Verification unavailable" in the console
- Verify action fails

**Checklist:**

| Check | Action |
|-------|--------|
| Record exists | Confirm the `decisionRecordId` is valid |
| Correct environment | Verification must happen in the same environment as capture |
| Workspace access | Your user must have access to the workspace containing the record |
| Timing | Verification may take a moment after capture — retry after a few seconds |

---

## Direct SDK vs Customer-Owned Proxy

**Direct (Builder pattern):**
```
Application → Verify SDK → Verify API
```
- Simplest setup — no infrastructure
- Application holds the API key
- Developer controls field selection via SDK
- Best for: evaluation, sandbox, single-developer testing

**Governed (Production/Enterprise pattern):**
```
Application → Customer-Owned Proxy → Capture Policy → Verify API
```
- API key centralized in the proxy (not in application code)
- Policy enforced at the boundary — applications cannot bypass field restrictions
- Auditable by compliance without accessing application source
- Best for: production, multi-team, governance-required, regulated industries

---

## Prompt / Response Terminology

The Verify platform uses specific field names for AI interaction content.

**Supported:**
```
prompt
response
```

**Avoid (will be rejected by the SDK):**
```
output
result
completion
answer
generation
```

Use `prompt` for input to the AI model and `response` for the AI model's output. These terms are consistent across the SDK, proxy, API, and console.

---

## Validation Checklist

After deployment, confirm each step:

| # | Check | How to Verify |
|---|-------|---------------|
| 1 | Record created | HTTP 201 + `decisionRecordId` in response |
| 2 | Record retrieved | Visible in Verify Console or via API GET |
| 3 | Record verified | Verify action returns `hashMatches: true`, `signatureValid: true` |
| 4 | Policy works | Allowed fields present, dropped fields absent |
| 5 | Logs safe | CloudWatch contains no API keys, prompts, responses, or PII |

---

## When to Contact Support

If you've exhausted this guide, contact Obligra support with:

**Include:**
- `decisionRecordId` (if available)
- `workflowId`
- Timestamp of the issue
- Environment (sandbox/dev/staging/production)
- Error message or HTTP status code
- Deployment type (Terraform / CloudFormation / SDK direct)

**Do not send:**
- API keys or key secrets
- Bearer tokens or auth credentials
- Prompt or response content
- Customer PII or sensitive data
- State files or tfvars content
