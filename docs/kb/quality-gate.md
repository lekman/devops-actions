# Quality Gate

The **quality-gate** CI job aggregates results from all upstream jobs and fails the workflow if required checks did not pass. It does not run tests or scans itself — it only evaluates outcomes.

## Reading the Output

When the gate fails, console output looks like:

```
Quality gate failed:
  - quality: failure
    → https://github.com/lekman/devops-actions/blob/main/docs/kb/quality-gate.md
  - security: cancelled
    → https://github.com/lekman/devops-actions/blob/main/docs/kb/security.md
```

Each line shows the job name and its result. The arrow links to the relevant KB page for that failure type.

## Job Results

| Result      | Meaning                                                              |
| ----------- | -------------------------------------------------------------------- |
| `success`   | Job completed without errors                                         |
| `failure`   | Job exited with a non-zero status                                    |
| `cancelled` | Job was cancelled (manually or by concurrency policy)                |
| `skipped`   | Job did not run because its `if` condition was false                 |
| `missing`   | Job not found in the results — likely a workflow configuration error |

## Required vs Conditional Jobs

The gate evaluates two groups:

| Group               | Jobs                                                                  | Rule                                                                                             |
| ------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Required            | `quality`, `security`                                                 | Must be `success`. Any other result is a failure                                                 |
| Conditional (infra) | `trunk-check`, `infra-preview`                                        | Must be `success` when infrastructure files changed. `skipped` is acceptable otherwise           |
| Conditional         | `audit`, `jvm-quality`, `jvm-audit`, `dotnet-quality`, `dotnet-audit` | Must be `success` when they run. `skipped` is acceptable, for a repository without that language |

The gate knows a label, a hint and a troubleshooting page for each of these
job names. A calling workflow gets the deep link to the job's log when its
job `name:` matches the label:

| Job              | Label                                 | Page              |
| ---------------- | ------------------------------------- | ----------------- |
| `jvm-quality`    | QA: JVM Format, Analysis, Build, Test | [JVM](jvm.md)     |
| `jvm-audit`      | Security: JVM Dependency Audit        | [JVM](jvm.md)     |
| `dotnet-quality` | QA: .NET Build, Format, Test          | [.NET](dotnet.md) |
| `dotnet-audit`   | Security: .NET Dependency Audit       | [.NET](dotnet.md) |

## The Opaque Quality Job

The `quality` job runs `turbo run build lint typecheck test:coverage` as a single pipeline. When it fails, the quality gate reports `quality: failure` but cannot tell you which sub-task caused it.

To narrow down the failure:

1. Open the workflow run in GitHub Actions
2. Expand the **quality** job
3. Look at the **Run turbo tasks** step output
4. Turbo prints which task failed (e.g., `@lekman/devops-toolkit#build`)
5. Jump to the matching KB page:

| Turbo Task      | KB Page                   |
| --------------- | ------------------------- |
| `build`         | [Build](build.md)         |
| `lint`          | [Lint](lint.md)           |
| `typecheck`     | [Typecheck](typecheck.md) |
| `test:coverage` | [Tests](tests.md)         |

If the quality job runs fallback commands (no `turbo.json`), each command runs as a separate step — check which step failed directly.

## Common Issues

| Symptom                               | Cause                                                    | Fix                                                                                                                                |
| ------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Gate fails but all jobs show success  | Job name mismatch between workflow and gate config       | Verify the `results` JSON in the quality-gate step matches the actual job names                                                    |
| `trunk-check: skipped` causes failure | Infrastructure files changed but Trunk is not configured | Add `.trunk/trunk.yaml` to the repo, or make `trunk-check` conditional                                                             |
| `infra-preview: missing`              | The `infra-preview` job is not defined in the workflow   | Expected if the repo has no `infra/Pulumi.yaml`. The gate treats missing conditional jobs as acceptable when infra has not changed |
