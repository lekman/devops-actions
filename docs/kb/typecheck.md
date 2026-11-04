# Typecheck Failures

Covers `tsc --noEmit` and `mypy` failures in the **quality** CI job.

The quality job runs `turbo run typecheck` (or `bun run typecheck` as fallback), which executes `tsc --noEmit` to check types without emitting output files.

## Common Failures

| Symptom                                             | Cause                                                                     | Fix                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Type errors in CI but not locally                   | Different TypeScript version                                              | Pin TypeScript in `devDependencies`. The toolkit uses TypeScript ^6.0                                   |
| Errors in files you did not change                  | A dependency updated its types, or `tsconfig.json` `include` is too broad | Check `tsconfig.json` includes/excludes. Ensure `node_modules`, `dist`, and `**/*.test.ts` are excluded |
| `Cannot find type definition file for 'bun'`        | `@types/bun` not installed                                                | Add `@types/bun` to `devDependencies` and run `bun install`                                             |
| `Module 'X' has no exported member 'Y'`             | Import from a package whose types changed                                 | Check the package changelog. Update the import to match the new API                                     |
| `TS5110: Option 'module' must be set to 'NodeNext'` | Conflicting `module` and `moduleResolution` settings                      | The toolkit uses `module: "ES2022"` with `moduleResolution: "bundler"`. Ensure both are set correctly   |

## Local Reproduction

```bash
bun run typecheck
```

This runs `tsc --noEmit` with the project's `tsconfig.json`. The output shows file paths, line numbers, and error codes — match these against the CI log to confirm the same errors.

## tsconfig.json Reference

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "strict": true,
    "moduleResolution": "bundler",
    "types": ["bun"],
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

Test files (`*.test.ts`) are excluded from compilation. If a test file has type errors, they will not surface in `typecheck` but may cause issues in `bun test`.

## mypy

For a Python repository the quality job runs `mypy .`, and only when
`pyproject.toml` contains a `[tool.mypy]` table. A project without that
table runs no typecheck phase.

The gate reads mypy's default output, `path:line: error: message [code]`.
Note lines are context for the error above them and are not reported as
findings of their own.

| Symptom                                          | Cause                                              | Fix                                                           |
| ------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------- |
| No typecheck phase runs                          | `pyproject.toml` has no `[tool.mypy]` table        | Add the table, even an empty one, to opt in                   |
| "configured in pyproject.toml but not installed" | mypy is configured but absent from the environment | Add mypy to your dev dependencies. CI reports this as skipped |
| Errors in files you did not change               | mypy checks the whole tree by default              | Narrow the scope with `files` or `exclude` in `[tool.mypy]`   |
