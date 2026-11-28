/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Findings producer for the `quality` job. Parses:
 *   - JUnit XML     -> test summary (pass/fail/error/skip) + failing tests
 *   - LCOV info     -> line coverage % (bun, jest, vitest, c8)
 *   - Cobertura XML -> line coverage % (pytest-cov, coverage.py, coverlet,
 *                      Microsoft code coverage)
 *   - JaCoCo XML    -> line coverage % (JaCoCo, Kover)
 *   - Lint log      -> error table (ESLint, Biome, ruff, black, ktlint,
 *                      detekt, google-java-format, dotnet format, generic)
 *   - Typecheck log -> error table (tsc, mypy, kotlinc, javac, C# compiler)
 *
 * JUnit and coverage inputs each take one path or several, and a directory
 * stands for every report below it, because Gradle and Maven write one
 * JUnit file per test class and one coverage report per module.
 *
 * Writes a compact markdown summary to `--out` for embedding inside the
 * quality-gate <details> body. Missing inputs degrade gracefully.
 */
import type { CoverageSummary, FileCoverage } from "./coverage.js";
export type { CoverageSummary, FileCoverage } from "./coverage.js";
export { parseCobertura, parseCoberturaLowCoverage, parseJacoco, parseJacocoLowCoverage, parseLcov, parseLcovLowCoverage, } from "./coverage.js";
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
export interface Finding {
    file: string;
    message: string;
    level: "error" | "warning";
}
/**
 * Parse totals from JUnit XML.
 *
 * bun's reporter puts the totals on the root `<testsuites>` element.
 * pytest leaves that element bare — `<testsuites name="pytest tests">` —
 * and writes the counts on each `<testsuite>` instead, so reading only the
 * root reports zero tests for a run that had plenty. When the root carries
 * no `tests` attribute, sum the suites. Gradle's and Maven Surefire's
 * per-class files have no `<testsuites>` root at all, only one
 * `<testsuite>`, which the same sum reads.
 */
export declare function parseJunit(xml: string): TestSummary | null;
/**
 * Add up the totals of several JUnit files. Returns null when none of them
 * was JUnit XML.
 */
export declare function sumJunit(xmls: readonly string[]): TestSummary | null;
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
 * Parse lint output for error lines. Handles ESLint stylish, Biome, ruff,
 * black, rustfmt, rustc and clippy, and generic `file:line:col: error
 * message` formats.
 *
 * The formats do not collide. The generic JS matcher requires a
 * .ts/.tsx/.js/.jsx extension, and the ruff matcher requires .py, so a
 * polyglot repo's merged log parses both halves correctly.
 */
export declare function parseLintLog(log: string): Finding[];
/**
 * Parse typechecker and compiler output:
 *
 *   tsc      `src/file.ts(12,5): error TS1234: message`
 *   mypy     `src/app.py:12: error: message  [assignment]`
 *   kotlinc  see matchJvmCompiler
 *   javac    see matchJvmCompiler
 *   C#       see matchMsbuild
 *
 * mypy's `note:` lines are context for the error above them, not findings
 * of their own, so they are left out.
 */
export declare function parseTypecheckLog(log: string): Finding[];
/**
 * Match a Kotlin or Java compiler diagnostic, as Gradle or Maven prints it:
 *
 *   kotlinc (Gradle)  `e: file:///abs/App.kt:3:5 Unresolved reference 'x'.`
 *   kotlinc (Maven)   `[ERROR] file:///abs/App.kt:3:5 Unresolved reference 'x'.`
 *   javac (Gradle)    `/abs/App.java:3: error: cannot find symbol`
 *   javac (Maven)     `[ERROR] /abs/App.java:[3,5] cannot find symbol`
 *
 * Warnings are left out. The jvm-quality action does not turn them into
 * errors, so listing them under "Type errors" would misreport the build.
 */
export declare function matchJvmCompiler(line: string): Finding | null;
/**
 * Match an MSBuild diagnostic for a C#, F# or VB file, as the C# compiler,
 * analyzers and `dotnet format` print it:
 *
 *   `/abs/App.cs(8,25): error CS0103: The name 'x' does not exist [/abs/App.csproj]`
 *
 * The trailing project path is dropped. Only errors are kept: the
 * dotnet-quality build treats warnings as errors, so a warning that
 * matters arrives as an error.
 */
export declare function matchMsbuild(line: string): Finding | null;
/**
 * Make a path from a log relative to the checkout, so the gate comment
 * shows `src/App.kt` rather than the runner's absolute path. Kotlin
 * compilers prefix paths with `file://`, which is removed too.
 *
 * @param file Path as the tool printed it, possibly with `:line:col`.
 * @param workspace Absolute checkout path, usually GITHUB_WORKSPACE.
 */
export declare function relativeToWorkspace(file: string, workspace: string): string;
export declare function formatFindings(tests: TestSummary | null, coverage: CoverageSummary | null, testFailures?: Finding[], lintFindings?: Finding[], typecheckFindings?: Finding[], lowCoverageFiles?: FileCoverage[]): string;
