/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Findings producer for the `quality` job. Parses:
 *   - JUnit XML     -> test summary (pass/fail/error/skip) + failing tests
 *   - LCOV info     -> line coverage % (bun, jest, vitest, c8)
 *   - Cobertura XML -> line coverage % (pytest-cov, coverage.py)
 *   - Lint log      -> error table (ESLint, Biome, ruff, black, generic)
 *   - Typecheck log -> error table (tsc, mypy)
 *
 * Writes a compact markdown summary to `--out` for embedding inside the
 * quality-gate <details> body. Missing inputs degrade gracefully.
 */
export interface TestSummary {
    tests: number;
    failures: number;
    /**
     * Tests that errored rather than failed an assertion — a fixture that
     * raised, or a module that would not import. pytest reports collection
     * failures here and leaves `failures` at zero, so a summary that ignores
     * this field calls a whole unimportable test file a clean run.
     */
    errors: number;
    skipped: number;
}
export interface CoverageSummary {
    linesFound: number;
    linesHit: number;
}
export interface Finding {
    file: string;
    message: string;
    level: "error" | "warning";
}
export interface FileCoverage {
    file: string;
    linesFound: number;
    linesHit: number;
    pct: number;
}
/**
 * Parse totals from JUnit XML.
 *
 * bun's reporter puts the totals on the root `<testsuites>` element.
 * pytest leaves that element bare — `<testsuites name="pytest tests">` —
 * and writes the counts on each `<testsuite>` instead, so reading only the
 * root reports zero tests for a run that had plenty. When the root carries
 * no `tests` attribute, sum the suites.
 */
export declare function parseJunit(xml: string): TestSummary | null;
/**
 * Walk `<testcase>` elements that hold a `<failure>` or `<error>` child.
 *
 * Passing tests are written self-closing (`<testcase ... />`) by pytest and
 * by bun, so a pattern that assumes every testcase has a closing tag runs
 * past the passing ones and pins the failure on the wrong test. Each
 * opening tag is therefore matched on its own and its body, if it has one,
 * is taken up to the next `</testcase>`.
 *
 * `<error>` counts alongside `<failure>` because a test that could not run
 * is not a test that passed.
 */
export declare function parseJunitFailures(xml: string): Finding[];
/**
 * Parse LCOV info format. Sum `LF:` (lines found) and `LH:` (lines hit)
 * across every record in the file — one record per source file, delimited
 * by `end_of_record`.
 */
export declare function parseLcov(info: string): CoverageSummary | null;
/**
 * Parse LCOV per-file. Returns files below COVERAGE_THRESHOLD, sorted
 * by coverage % ascending (worst first), capped at MAX_FINDINGS.
 */
export declare function parseLcovLowCoverage(info: string): FileCoverage[];
/**
 * Parse a Cobertura XML report, the format pytest-cov and coverage.py
 * write. The root element carries `lines-valid` and `lines-covered`:
 *
 *   <coverage lines-valid="8" lines-covered="7" line-rate="0.875" ...>
 *
 * Verified against coverage.py 7.16.0. Writers that emit only `line-rate`
 * give a percentage with no denominator, so the `<line hits="...">`
 * elements are summed instead rather than inventing a total.
 */
export declare function parseCobertura(xml: string): CoverageSummary | null;
/**
 * Parse Cobertura per-file coverage. Returns files below
 * COVERAGE_THRESHOLD, worst first, capped at MAX_FINDINGS.
 *
 * Per-class elements carry `line-rate` but no line counts, so the counts
 * come from the `<line hits="...">` children inside each `<class>`.
 */
export declare function parseCoberturaLowCoverage(xml: string): FileCoverage[];
/**
 * Parse lint output for error lines. Handles ESLint stylish, Biome, ruff,
 * black, and generic `file:line:col: error message` formats.
 *
 * The formats do not collide. The generic JS matcher requires a
 * .ts/.tsx/.js/.jsx extension, and the ruff matcher requires .py, so a
 * polyglot repo's merged log parses both halves correctly.
 */
export declare function parseLintLog(log: string): Finding[];
/**
 * Parse typechecker output. Two formats:
 *
 *   tsc   `src/file.ts(12,5): error TS1234: message`
 *   mypy  `src/app.py:12: error: message  [assignment]`
 *
 * mypy's `note:` lines are context for the error above them, not findings
 * of their own, so they are left out.
 */
export declare function parseTypecheckLog(log: string): Finding[];
export declare function formatFindings(tests: TestSummary | null, coverage: CoverageSummary | null, testFailures?: Finding[], lintFindings?: Finding[], typecheckFindings?: Finding[], lowCoverageFiles?: FileCoverage[]): string;
