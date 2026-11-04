# Test Failures

Covers test failures and coverage issues in the **quality** CI job.

For a TypeScript repository the quality job runs `turbo run test:coverage`, or `bun test` as a fallback. Tests use Bun's built-in test runner (`bun:test`).

For a Python repository it runs `pytest`. See [Python Projects](python.md) for what enables that and how coverage is configured; the sections below cover the parts both languages share.

## Common Failures

| Symptom                                   | Cause                                               | Fix                                                                                                              |
| ----------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| One or more tests fail                    | Assertion mismatch or runtime error in test code    | Run `bun test` locally to reproduce. Check the test output for the failing assertion                             |
| Tests pass locally but fail in CI         | Environment difference (timing, file system, ARM64) | Check for timing-dependent assertions or hardcoded paths. The CI runs on `nb-runner-arm64` (ARM64 macOS)         |
| Test timeout                              | Test takes longer than Bun's default timeout (5s)   | Increase the timeout with `test("name", () => { ... }, { timeout: 10_000 })` or investigate why the test is slow |
| `Cannot find module` in test              | Import path wrong or dependency not installed       | Check import paths use correct relative references. Run `bun install`                                            |
| `ReferenceError: describe is not defined` | Test file not recognised by Bun test runner         | Ensure the file matches the test pattern (`*.test.ts`). Import from `bun:test` explicitly                        |

## Test Patterns

The toolkit uses custom assertion helpers and builders in `tests/fixtures/`:

```typescript
// Fluent assertions
expectGate(input).toPass();
expectGate(input).toFailWith("quality", "security");

// Test data builders
const input = aGateInput().withResult("quality", "failure").build();
```

When adding tests, check `tests/fixtures/assertions.ts` and `tests/fixtures/builders.ts` for existing helpers before writing raw assertions.

## Coverage

Coverage is tracked via Bun's built-in `--coverage` flag when running `test:coverage`. The CI reports coverage but does not block on thresholds.

| Symptom                                | Cause                                   | Fix                                                                           |
| -------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| Low coverage on new code               | Tests do not exercise all code paths    | Add tests for uncovered branches. Focus on business logic, not infrastructure |
| Coverage includes files outside `src/` | Bun tracks all executed code by default | Configure coverage exclusions in `bunfig.toml`                                |

## Local Reproduction

```bash
# Run all tests
bun test

# Run a specific test file
bun test tests/quality-gate.test.ts

# Run with coverage
bun test --coverage
```

## Reading pytest Results

The gate reads `junit.xml` for the pass and fail counts, and `coverage.xml`
for coverage. pytest writes both when the test step runs.

pytest reports a module that fails to import as an error rather than a
failure, and it counts separately from assertion failures. The gate counts
errors alongside failures, so a test file that will not import shows as red
rather than as a clean run.

| Symptom                                      | Cause                                                     | Fix                                                                         |
| -------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| Gate shows no test line for a Python repo    | `junit.xml` was not written, so the test step did not run | Check that `[tool.pytest.*]` or a `tests/` directory exists                 |
| Gate reports errors rather than failures     | A test module raised during collection, often an import   | Read the pytest log for the traceback. Fix the import before the assertions |
| Failing test names show a module, not a file | pytest records `classname` and no file attribute          | Expected. The module path is what pytest provides                           |
