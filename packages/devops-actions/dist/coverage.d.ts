/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Line coverage from the three report formats the shared CI meets:
 *
 *   LCOV       bun, jest, vitest, c8
 *   Cobertura  pytest-cov, coverage.py, coverlet, Microsoft code coverage
 *   JaCoCo     JaCoCo and Kover (Kover writes JaCoCo's XML format)
 *
 * Used by findings-tests for the gate comment and by coverage-check for
 * the coverage floor, so both read the same number.
 */
export interface CoverageSummary {
    linesFound: number;
    linesHit: number;
}
export interface FileCoverage {
    file: string;
    linesFound: number;
    linesHit: number;
    pct: number;
}
export type CoverageFormat = "lcov" | "cobertura" | "jacoco";
export declare const MAX_LOW_COVERAGE_FILES = 20;
export declare const COVERAGE_THRESHOLD = 80;
/**
 * Parse LCOV info format. Sum `LF:` (lines found) and `LH:` (lines hit)
 * across every record in the file — one record per source file, delimited
 * by `end_of_record`.
 */
export declare function parseLcov(info: string): CoverageSummary | null;
/**
 * Parse LCOV per-file. Returns files below COVERAGE_THRESHOLD, sorted
 * by coverage % ascending (worst first), capped at MAX_LOW_COVERAGE_FILES.
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
 * COVERAGE_THRESHOLD, worst first, capped at MAX_LOW_COVERAGE_FILES.
 *
 * Per-class elements carry `line-rate` but no line counts, so the counts
 * come from the `<line hits="...">` children inside each `<class>`.
 * coverlet and Microsoft code coverage write one `<class>` per type, so
 * classes sharing a file are added up before the threshold applies.
 */
export declare function parseCoberturaLowCoverage(xml: string): FileCoverage[];
/**
 * Parse a JaCoCo XML report, as JaCoCo and Kover write it. The totals are
 * the `<counter type="LINE">` directly under `<report>`, after every
 * `<group>` and `<package>`:
 *
 *   <report name="x"> <package>…</package> <counter type="LINE" missed="6" covered="1"/> </report>
 *
 * Checked against the reports Gradle 9.9.1's JaCoCo plugin and Kover
 * 0.9.11 write. The nested blocks are removed first, so only the report's
 * own counters remain.
 */
export declare function parseJacoco(xml: string): CoverageSummary | null;
/**
 * Parse JaCoCo per-file coverage from its `<sourcefile>` elements, named
 * `<package>/<file>` (e.g. `com/acme/Greeter.kt`). Returns files below
 * COVERAGE_THRESHOLD, worst first, capped at MAX_LOW_COVERAGE_FILES.
 */
export declare function parseJacocoLowCoverage(xml: string): FileCoverage[];
/**
 * Tell the format of a report from its content. LCOV is text with `SF:`
 * records, Cobertura's root is `<coverage>`, JaCoCo's is `<report>`.
 */
export declare function detectCoverageFormat(text: string): CoverageFormat | null;
/** Parse one report of a known format. */
export declare function parseCoverage(text: string, format: CoverageFormat): CoverageSummary | null;
/** Per-file coverage below the threshold for one report of a known format. */
export declare function parseLowCoverage(text: string, format: CoverageFormat): FileCoverage[];
/**
 * Line hits per file from a Cobertura report: file to line number to
 * whether any hit was recorded. A line listed under a method and again
 * under its class counts once.
 */
export declare function coberturaLines(xml: string): Map<string, Map<string, boolean>>;
/**
 * Combine several reports into one total.
 *
 * A multi-module Gradle or Maven build writes one JaCoCo report per module,
 * each covering only that module's classes, so their line counts are
 * added. Several Cobertura reports are merged line by line (see
 * mergeCobertura). A report that appears twice with the same content, as
 * VSTest leaves a copy beside its TRX file, is read once. Reports whose
 * format cannot be told, or that hold no line counts, are left out.
 *
 * @param texts Report contents.
 * @returns The total, or a null summary when no report held line counts.
 */
export declare function combineCoverage(texts: readonly string[]): {
    summary: CoverageSummary | null;
    lowCoverageFiles: FileCoverage[];
};
/** Line coverage as a percentage, or null when there are no lines. */
export declare function linePercent(summary: CoverageSummary | null): number | null;
/**
 * Expand a list of report paths. Entries are separated by newlines or
 * commas. A file is taken as it is; a directory contributes every file
 * below it whose name ends with one of `extensions`. Missing paths are
 * skipped, and the result holds each file once, in a stable order.
 *
 * @param spec Paths as a caller passes them, e.g. an action input.
 * @param extensions File name endings to collect from directories.
 * @param base Directory that relative paths resolve against.
 */
export declare function expandReportPaths(spec: string, extensions: readonly string[], base?: string): string[];
/** Read each file, skipping any that cannot be read. */
export declare function readAll(paths: readonly string[]): string[];
