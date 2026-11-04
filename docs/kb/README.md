# Troubleshooting Knowledge Base

Quick reference for resolving CI failures from the devops-toolkit pipeline. Find the failing job, open the matching page, look up your symptom.

## Pages

| Page                                        | CI Job               | Failure Category | When to Read                                               |
| ------------------------------------------- | -------------------- | ---------------- | ---------------------------------------------------------- |
| [Build](build.md)                           | quality              | build            | `turbo build` or `tsc` compilation errors                  |
| [Typecheck](typecheck.md)                   | quality              | build            | `tsc --noEmit` or `mypy` type errors                       |
| [Lint](lint.md)                             | quality, trunk-check | lint             | ESLint, ruff, black, or Trunk linter violations            |
| [Tests](tests.md)                           | quality              | test             | `bun test` or `pytest` failures, coverage issues           |
| [Python Projects](python.md)                | quality, audit       | build, test      | Anything specific to a Python repository                   |
| [Security](security.md)                     | security, audit      | security         | Semgrep SAST findings, dependency advisories               |
| [Secrets](secrets.md)                       | security             | secrets          | Gitleaks secret detection findings                         |
| [Trunk](trunk.md)                           | trunk-check          | lint             | Trunk-managed linter failures (shellcheck, yamllint, etc.) |
| [Infrastructure](infra.md)                  | infra-preview        | infra            | Pulumi preview/deploy or Azure OIDC failures               |
| [Azure Functions](functions.md)             | function-publish     | publish          | Publishing a Python project to a Flex Consumption app      |
| [Branch Maintenance](branch-maintenance.md) | branch-check         | —                | Merge conflicts, stale branches, auto-update issues        |
| [Quality Gate](quality-gate.md)             | quality-gate         | —                | Understanding the pass/fail decision                       |

## How This Works

The CI workflow ([ci.yml](../../.github/workflows/ci.yml)) runs several jobs. When a job fails:

The **quality-gate** job prints the failing job name with a link to the relevant KB page.

The `quality` job runs build, lint, typecheck, and test together via Turborepo. When it fails, the quality gate cannot determine which sub-task caused the failure — see [Quality Gate](quality-gate.md) for how to narrow it down.
