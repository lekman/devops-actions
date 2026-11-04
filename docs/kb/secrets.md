# Secret Detection

## What runs

The CI security job runs **Gitleaks** against the repository working tree to detect hardcoded secrets, API keys, tokens, and private keys. It scans file contents using pattern-based rules.

Gitleaks runs alongside Semgrep SAST in the same CI job. Both tools must pass for the security check to succeed.

## Common findings

| Rule                | Example                                    | Fix                                                      |
| ------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `generic-api-key`   | `AKIAIOSFODNN7EXAMPLE` in source           | Move to environment variable or secret manager           |
| `private-key`       | `-----BEGIN RSA PRIVATE KEY-----`          | Remove from repo, rotate the key, use vault              |
| `github-pat`        | `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Revoke in GitHub Settings > Tokens, use `GITHUB_TOKEN`   |
| `aws-access-key-id` | `AKIA...` prefix in config                 | Use IAM roles or `aws-actions/configure-aws-credentials` |

## How to fix

1. **Remove the secret from source** — delete the line or move the value to an environment variable.
2. **Rotate the credential** — assume it is compromised. Generate a new one and revoke the old.
3. **Add to `.gitleaksignore`** if the match is a false positive (e.g. a test fixture with a dummy value). Format: one fingerprint per line, taken from the Gitleaks JSON output's `Fingerprint` field.

## False positives

Create a `.gitleaksignore` file in the repository root. Each line is a Gitleaks fingerprint (the hash from the JSON report). Gitleaks skips matches whose fingerprint appears in this file.

```
# Example: dummy API key used in test fixtures
abc123def456:generic-api-key:src/tests/fixtures/config.ts
```

## Related

- [Security (Semgrep SAST)](security.md) — covers code-level vulnerabilities detected by Semgrep.
- [Gitleaks documentation](https://github.com/gitleaks/gitleaks) — full rule list, configuration, and `.gitleaks.toml` customisation.
