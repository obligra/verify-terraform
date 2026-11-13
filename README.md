# Obligra Verify capture proxy

> **Status: unreleased remediation candidate.** Offline checks are not deployment or production acceptance. Do not deploy this revision or send sensitive data until independent review, infrastructure validation and a current synthetic end-to-end test are complete. Earlier June validation reports are historical.

## Two integration paths

- **Direct SDK quickstart:** your backend calls the Python or Node SDK with a fictional record. The SDK sends selected data directly to Verify. Installing the SDK does not install this proxy.
- **Controlled capture:** your backend calls this optional customer-managed AWS proxy. The proxy applies its configured policy, then sends the resulting record to Verify. It does not automatically observe model traffic, call a model, or collect your files. Your application explicitly chooses when to submit.

These are integration choices, not a statement of current pricing or plan entitlements.

## Current contract

The outbound endpoint is `POST https://api.obligra.ai/decision-records`, with `X-Verify-Api-Key`. `/api/v1` is not the capture base. This candidate rejects alternate base URLs rather than forwarding a key to them.

The key determines workspace/environment capture scope. `environment_name` and `EnvironmentName` label AWS resources; they do not override the environment bound to a key. Keep the environment-scoped capture key server-side. Use a key with capture permission for the intended test environment.

A record contains:
- `workflowId`: nonempty string, at most 128 characters.
- `model`: required `provider` and `modelId` strings (at most 64 and 128 characters).
- `operationalContext`: required map of short string references. At most 20 keys, key length at most 64, value length at most 128.
- `aiAssistedContext`: optional string-valued map for AI content, separate from retrieval references.

The proxy has a conservative 128 KiB request/response limit. This is below the service's 256 KiB body limit. `environmentId` in the request body is rejected. Legacy top-level or operational-context prompt placement is rejected in policy mode. No content is silently truncated.

## Authentication and deployment boundary

The POST route uses `AWS_IAM`. Your backend caller needs AWS credentials and permission to invoke the deployed route, and signs the request with SigV4. Caller credentials are separate from the Verify capture key held by the proxy. Unsigned curl requests and direct browser calls are not supported. There are no CORS settings or OPTIONS route in this candidate.

Resources: an HTTP API, Lambda function, Lambda execution role and CloudWatch log group. The Lambda role permits log writes only. The template does not grant Obligra an IAM role in your account and does not enforce a network egress allowlist. Data that you submit is processed by the hosted Verify service. This is not a claim of provider-blind encryption or customer-only decryption.

Do not restore a previously disabled deployment as a side effect of source updates. Deployment, IAM permissions and runtime restoration require their own reviewed scope.

## Policy behavior

Default/empty configuration uses `intent_only`. Malformed configuration and unknown policy properties are rejected, never converted to pass-through. Use the exact supported field names; misspelled security settings fail closed. In `policy` mode, operational-context selection always uses an explicit allowlist; `dropUnknownKeys: false` is rejected.

| Mode | Behavior |
| --- | --- |
| `intent_only` | Workflow and required model metadata with a `captureMode` reference; no AI content. |
| `forward_all` | Current-contract record forwarded after recursive named-key exclusions. This is not PII classification. |
| `policy` | Only explicitly allowlisted operational-context keys and explicitly enabled AI prompt/response fields. Other AI fields are rejected until a supported policy mapping is defined. |

`security.neverForward` performs case-insensitive named-key exclusions, including nested keys, in every mode. This is not content-aware redaction: putting a sensitive value under an unrelated allowed key will not classify or remove it. Excluding a required contract field results in rejection, not a malformed outbound request.

`redactedKeys` applies only in `policy` mode and omits matching keys; it does not retain an empty value. Model inclusion settings must be booleans; excluding required model metadata causes rejection. An explicit length limit rejects overlong values instead of truncating a decision record.

```json
{
  "mode": "policy",
  "capture": {
    "operationalContext": {"allowedKeys": ["ticketId"], "maxValueLength": 128},
    "prompt": {"allow": true, "maxLength": 2000},
    "response": {"allow": true, "maxLength": 2000}
  },
  "security": {"neverForward": ["authToken", "password"]}
}
```

## Signed synthetic invocation example

This example is for a separately approved, validated deployment. It does not deploy resources. It uses the AWS credential provider chain and the caller's `execute-api:Invoke` permission. Do not print or paste credentials. Install the standard `boto3` package in your test environment if needed.

```python
import json, os, urllib.request
import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

session = boto3.Session()
credentials = session.get_credentials().get_frozen_credentials()
endpoint = os.environ["VERIFY_PROXY_ENDPOINT"]  # approved HTTPS route
region = os.environ["AWS_REGION"]
body = json.dumps({
    "workflowId": "synthetic-proxy-demo",
    "model": {"provider": "synthetic", "modelId": "offline-fixture"},
    "operationalContext": {"ticketId": "DEMO-001"},
    "aiAssistedContext": {"prompt": "Fictional prompt", "response": "Fictional response"}
}).encode()
request = AWSRequest(method="POST", url=endpoint, data=body,
                     headers={"Content-Type": "application/json"})
SigV4Auth(credentials, "execute-api", region).add_auth(request)
prepared = urllib.request.Request(endpoint, data=body,
    headers=dict(request.headers), method="POST")
with urllib.request.urlopen(prepared, timeout=15) as response:
    receipt = json.load(response)
assert isinstance(receipt.get("decisionRecordId"), str) and receipt["decisionRecordId"]
print(receipt["decisionRecordId"])
```

Use only the approved endpoint from your own deployment. The example sends synthetic data, not a real model call. `intent_only` will intentionally omit its AI content. Configure `policy` explicitly if the test is intended to retain that content.

## Key handling and logs

CloudFormation `NoEcho` and Terraform `sensitive` mask selected displays, not every copy of a secret. Terraform state can contain the key. Privileged users can access configured Lambda values. Protect state, shell history and deployment tooling; never commit keys or tfvars/state containing them. The capture key is transmitted to Verify over HTTPS.

The remediation handler does not log request bodies, identifiers or policy parse exceptions. Audit your application, infrastructure and external tooling independently. Absence of handler logs is not proof that other components never log data.

## Acceptance before release

1. Validate CloudFormation and Terraform configuration and package generation.
2. Independently review caller authentication, policy exclusions and transport failure behavior.
3. Exercise rejected callers, malformed policy, excluded fields, limits and interrupted responses.
4. In a separately approved deployment, submit fictional data and retain the real receipt.
5. Retrieve that exact record in the correct console workspace/environment, check field contents and integrity.
6. Confirm logging, access and cleanup. A successful deploy or HTTP response alone is not end-to-end validation.

The console's retrieval and verification authentication is separate from the capture key. A signature/integrity result does not establish the factual accuracy of submitted content.

## Sources and other integrations

- [Python SDK](https://github.com/obligra/verify-python-sdk)
- [Node SDK](https://github.com/obligra/verify-node-sdk)
- [CloudFormation](https://github.com/obligra/verify-cloudformation)
- [Terraform](https://github.com/obligra/verify-terraform)

The CloudFormation repository also contains a nested legacy Terraform copy. This local candidate synchronizes its handler and authentication with the standalone implementation; that does not establish that a released deployment contains these changes.
