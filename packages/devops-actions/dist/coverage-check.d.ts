/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * The coverage floor for the jvm-quality and dotnet-quality actions.
 * Reads JaCoCo, Kover, Cobertura or LCOV reports, adds them up the way
 * findings-tests does, and fails when line coverage is below a threshold.
 *
 * One checker for every language keeps one number: the percentage that
 * fails the job is the percentage the gate comment shows. The default
 * threshold of 80% is the line the gate comment already draws: files below
 * it are listed as low coverage, and the summary turns green at 80%.
 *
 * A run that produced no coverage report fails too. A floor that passes
 * when nothing was measured is not a floor.
 */
import type { CoverageSummary } from "./coverage.js";
export type CoverageResult = "passed" | "failed" | "missing";
export interface CoverageVerdict {
    result: CoverageResult;
    /** Line coverage to one decimal, or "" when nothing was measured. */
    percent: string;
    message: string;
}
/**
 * Compare line coverage against a threshold.
 *
 * @param summary Combined line counts, or null when no report was read.
 * @param threshold Minimum line coverage in percent.
 */
export declare function checkCoverage(summary: CoverageSummary | null, threshold: number): CoverageVerdict;
