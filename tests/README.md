Run from the repository root:

```sh
node tests/policy.test.cjs
node tests/transport.test.cjs
```

These are isolated synthetic VM/transport mocks with no network, AWS credentials or service calls. They do not replace Terraform/CloudFormation validation or a live signed capture acceptance test. Tested locally with Node24; the source now targets Node24; an actual Lambda runtime acceptance test remains separate.
