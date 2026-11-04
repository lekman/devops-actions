# Security Scan Failures

Covers Semgrep SAST findings in the **security** CI job, and dependency
advisories in the **audit** job.

The security job runs `semgrep scan --error` with three rulesets:
`p/security-audit`, `p/secrets`, `p/typescript`. A repository containing
Python adds `p/python`. Any finding causes the job to exit non-zero.

## Common Findings

| Symptom                         | Cause                                                      | Fix                                                                                                  |
| ------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `semgrep` exits with findings   | Code matches a security rule pattern                       | Review each finding in the CI log. Fix the flagged pattern or suppress if it is a false positive     |
| Hardcoded secret detected       | String matches a secret pattern (API key, token, password) | Move the secret to an environment variable or secret store. If it is a test fixture, suppress inline |
| SQL injection warning           | String concatenation in a query                            | Use parameterised queries or prepared statements                                                     |
| Dynamic code execution detected | Dangerous function usage flagged by rule                   | Replace with a safer alternative. If the input is trusted and validated, suppress with justification |
| Insecure randomness             | `Math.random()` used in a security context                 | Use `crypto.getRandomValues()` or `crypto.randomUUID()` instead                                      |

## Rulesets

| Ruleset            | Focus                                                      |
| ------------------ | ---------------------------------------------------------- |
| `p/security-audit` | OWASP Top 10, injection, authentication, access control    |
| `p/secrets`        | Hardcoded credentials, API keys, tokens                    |
| `p/typescript`     | TypeScript-specific patterns (type coercion, unsafe casts) |

Custom rulesets can be specified via the `rulesets` input on the security action.

## Suppressing False Positives

Add a `nosemgrep` comment on the flagged line with the rule ID and a justification:

```typescript
// nosemgrep: rule-id-here -- justification for why this is safe
```

Always include a justification explaining why the pattern is safe. Reviewers should verify the justification during PR review.

To exclude entire directories, create a `.semgrepignore` file at the repo root:

```text
# Build output
dist/
coverage/
.turbo/

# Generated code
**/generated/

# Test fixtures
**/fixtures/sample-logs/
```

## ARM64 Note

The security action runs `semgrep` CLI directly (not `returntocorp/semgrep-action`) because the Docker-based action has no ARM64 image. Semgrep must be pre-installed on the runner — the `nb-runner-arm64` runner includes it.

## Local Reproduction

```bash
# Install semgrep
pip install semgrep

# Run with the same rulesets as CI
semgrep scan --error --config p/security-audit --config p/secrets --config p/typescript
```

## Dependency Advisories

The audit job runs for Python repositories and reports known advisories
against the project's resolved dependencies. It appears as its own row in
the Security Gate.

Advisories do not fail the job. An audit that could not run does, because
the gate row cannot distinguish an audit that found nothing from one that
never ran. See [Python Projects](python.md) for how dependencies are
exported and how to change that default.
