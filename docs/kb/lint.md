# Lint Failures

Covers ESLint, ruff and black failures in the **quality** CI job, and linter failures in the **trunk-check** job.

The quality job runs `turbo run lint` (or `bun run lint` as fallback), which executes ESLint on `src/`. The trunk-check job runs Trunk-managed linters — see [Trunk](trunk.md) for those.

## Common Failures

| Symptom                                 | Cause                                                   | Fix                                                                                               |
| --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| ESLint errors in CI                     | Code violates ESLint rules from `@lekman/eslint-config` | Run `bun run lint` locally to see all violations. Fix manually or use auto-fix where available    |
| `Parsing error: Unexpected token`       | ESLint cannot parse the file (wrong parser or syntax)   | Ensure `@typescript-eslint/parser` is configured. Check that the file is TypeScript, not plain JS |
| `Definition for rule 'X' was not found` | ESLint plugin missing or version mismatch               | Run `bun install` to ensure all ESLint plugins are installed                                      |
| Lint passes locally but fails in CI     | Different ESLint or plugin versions                     | Check `bun.lock` is committed. The CI runs `bun install --frozen-lockfile`                        |
| Copyright header violation              | Source file missing the required copyright comment      | Add `/** Copyright (c) Tobias Lekman. All rights reserved. */` at the top of each `.ts` file      |

## Auto-Fix

Some ESLint rules support auto-fix. The toolkit does not expose a `lint:fix` script by default, but you can run:

```bash
bunx eslint src/ --fix
```

Review the changes before committing — auto-fix can occasionally produce unexpected results with import ordering or formatting rules.

## ESLint Configuration

The toolkit uses ESLint flat config via the workspace package `@lekman/eslint-config`. This config includes:

- `@typescript-eslint` rules for TypeScript
- `eslint-plugin-import-x` for import ordering
- `eslint-plugin-jsdoc` for documentation
- `eslint-plugin-headers` for copyright header enforcement
- Prettier integration for formatting

To see the resolved config:

```bash
bunx eslint --print-config src/quality-gate.ts
```

## Suppressing a Rule Inline

```typescript
// eslint-disable-next-line no-console -- CLI entrypoint, console output is intentional
console.log("message");
```

Always include a justification comment explaining why the rule is disabled. Blanket `eslint-disable` without a rule name should be avoided.

## Python Linters

The quality job runs the linters that `pyproject.toml` configures. A
`[tool.ruff]` table runs `ruff check`, and a `[tool.black]` table runs
`black --check`. Both run when both are configured, and the phase passes
only if both pass.

Ruff is invoked with `--output-format=concise`, which produces one line per
finding in the form `path:line:col: CODE message`. The gate parses that
shape. Ruff's default format is a multi-line diagnostic that the parser does
not read, so findings would appear in the job log and not in the PR comment.
Pin the format the same way if you script ruff yourself.

`flake8` and `pylint` are detected but not run, because neither has a stable
default output format the parser reads. Running them would produce a failing
phase with an empty findings table.

| Symptom                                             | Cause                                                          | Fix                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| "configured in pyproject.toml but is not installed" | The tool has a config table but is absent from the environment | Add it to your dev dependencies. CI reports this as skipped, not as lint findings |
| Ruff findings in the log but not in the PR comment  | Ruff ran with its default output format                        | Use `--output-format=concise`, which is what CI passes                            |
| No lint phase runs at all                           | `pyproject.toml` configures none of the supported tools        | Add a `[tool.ruff]` or `[tool.black]` table                                       |
