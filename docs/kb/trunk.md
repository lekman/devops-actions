# Trunk Linter Failures

Covers Trunk-managed linter failures in the **trunk-check** CI job.

The trunk-check job runs `trunk check` on the PR diff (or last commit on push). Trunk orchestrates multiple linters and posts inline annotations via the GitHub Checks API. This job only runs if `.trunk/trunk.yaml` exists in the repo.

## Dependencies Before Trunk

When the repository has `bun.lock` or `bun.lockb` at its root, the action runs `bun install --frozen-lockfile` before `trunk check`. A Trunk plugin loaded as a `local:` source from `node_modules`, or a linter that runs a binary from `node_modules/.bin`, needs those files. A repository without a Bun lockfile installs nothing.

| Symptom                                                                 | Cause                                                              | Fix                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `'node_modules/...' does not exist` (`trunk/config-error`)              | The plugin source is in `node_modules`, and no Bun lockfile exists | Commit `bun.lock`, so the action installs the dependencies                                                           |
| `bun install` fails with 401 or 403 for an `@scope` package             | The job cannot read the package from GitHub Packages               | Give the calling job `packages: read`, and give the repository Actions access to the package in its package settings |
| `bun install` fails with `lockfile had changes, but lockfile is frozen` | `bun.lock` does not match `package.json`                           | Run `bun install` locally and commit `bun.lock`                                                                      |

## Per-Linter Failures

### shellcheck (Shell Scripts)

| Symptom                                                       | Cause                                                       | Fix                                                             |
| ------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| `SC2086: Double quote to prevent globbing and word splitting` | Unquoted variable expansion                                 | Wrap the variable in double quotes: `"$var"`                    |
| `SC2046: Quote this to prevent word splitting`                | Command substitution used without quotes                    | Use `"$(command)"` instead of `$(command)`                      |
| `SC1091: Not following: file not found`                       | `source` or `.` references a file shellcheck cannot resolve | Add `# shellcheck source=path/to/file` directive above the line |

### shfmt (Shell Formatting)

| Symptom                         | Cause                                   | Fix                                     |
| ------------------------------- | --------------------------------------- | --------------------------------------- |
| Formatting differences detected | Shell script does not match shfmt style | Run `shfmt -w script.sh` to auto-format |

### yamllint (YAML)

| Symptom                                       | Cause                                          | Fix                                                          |
| --------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| `line too long`                               | YAML line exceeds max length                   | Break the line or configure `line-length` in `.yamllint.yml` |
| `truthy value should be one of [false, true]` | Bare `yes`/`no` used instead of `true`/`false` | Use `true`/`false` for boolean values                        |

### markdownlint (Markdown)

| Symptom                                           | Cause                                | Fix                                                                       |
| ------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| `MD013: Line length`                              | Markdown line exceeds limit          | Break the line. Tables are often excluded via `.markdownlint.json` config |
| `MD041: First line should be a top-level heading` | File does not start with `# Heading` | Add an H1 heading at the top of the file                                  |

### actionlint (GitHub Actions)

| Symptom                             | Cause                                            | Fix                                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expression type mismatch`          | Workflow expression has wrong type               | Check the expression syntax. Refer to [GitHub Actions expressions docs](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/evaluate-expressions-in-a-workflow) |
| `unknown input` on action reference | Action input name is wrong or the action changed | Check the action's `action.yml` for valid input names                                                                                                                                             |

### hadolint (Dockerfiles)

| Symptom                                   | Cause                                     | Fix                                                           |
| ----------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `DL3008: Pin versions in apt-get install` | Package installed without version pinning | Pin with `package=version` or add a `hadolint ignore` comment |
| `DL3007: Using latest is prone to errors` | `FROM image:latest` used                  | Pin the base image to a specific tag or digest                |

### checkov (IaC Security)

| Symptom                      | Cause                                                   | Fix                                                             |
| ---------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| IaC misconfiguration finding | Terraform, CloudFormation, or Dockerfile security issue | Review the finding ID and follow Checkov's remediation guidance |

### osv-scanner (Dependency Vulnerabilities)

| Symptom                           | Cause                            | Fix                                                                                         |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| Known vulnerability in dependency | A dependency has a published CVE | Update to the fixed version. If no fix exists, evaluate the risk and document the exception |

### trufflehog (Secret Scanning)

| Symptom                                 | Cause                                   | Fix                                                                                                 |
| --------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Secret or credential detected in source | A string matches a known secret pattern | Remove the secret from source. Rotate the credential. Use environment variables or a secret manager |

### prettier (Formatting)

| Symptom                         | Cause                              | Fix                                                         |
| ------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| Formatting differences detected | File does not match Prettier style | Run `prettier --write .` to auto-format. Commit the changes |

## Running Trunk Locally

```bash
# Install Trunk CLI
curl https://get.trunk.io -fsSL | bash

# Check all files
trunk check

# Check specific files
trunk check path/to/file.ts

# Auto-fix where possible
trunk fmt
```

## Suppressing Findings

Each linter has its own inline suppression syntax. See the individual linter docs. Trunk also supports `.trunk/trunk.yaml` overrides to disable specific linters or rules per path.
