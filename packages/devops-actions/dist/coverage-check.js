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
import { appendFileSync } from "node:fs";
import { combineCoverage, expandReportPaths, linePercent, readAll, } from "./coverage.js";
/**
 * Compare line coverage against a threshold.
 *
 * @param summary Combined line counts, or null when no report was read.
 * @param threshold Minimum line coverage in percent.
 */
export function checkCoverage(summary, threshold) {
    const pct = linePercent(summary);
    if (pct === null || summary === null) {
        return {
            result: "missing",
            percent: "",
            message: "no coverage report with line counts was found, so the coverage floor could not be checked",
        };
    }
    // One decimal, rounded the way the gate comment rounds it, so both show
    // the same number. A value just under the floor that rounds up to it is
    // shown with two decimals instead, so the message never reads "80.0% is
    // below the 80% floor".
    const below = pct < threshold;
    let percent = pct.toFixed(1);
    if (below && Number(percent) >= threshold)
        percent = pct.toFixed(2);
    const counts = `${summary.linesHit}/${summary.linesFound} lines`;
    if (below) {
        return {
            result: "failed",
            percent,
            message: `line coverage ${percent}% (${counts}) is below the ${threshold}% floor`,
        };
    }
    return {
        result: "passed",
        percent,
        message: `line coverage ${percent}% (${counts}) meets the ${threshold}% floor`,
    };
}
// ---- CLI ----
/* eslint-disable no-console -- CLI entrypoint, console output is intentional */
function main() {
    const args = new Map();
    for (let i = 2; i < process.argv.length; i += 2) {
        const key = process.argv[i]?.replace(/^--/, "");
        const value = process.argv[i + 1];
        if (key && value !== undefined)
            args.set(key, value);
    }
    const threshold = Number(args.get("threshold") ?? "80");
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
        console.error(`::error title=Coverage::threshold must be 0 to 100, got '${args.get("threshold")}'`);
        process.exit(1);
    }
    const paths = expandReportPaths(args.get("reports") ?? "", [".xml", ".info"]);
    const { summary } = combineCoverage(readAll(paths));
    const verdict = checkCoverage(summary, threshold);
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (githubOutput) {
        appendFileSync(githubOutput, `result=${verdict.result}\npercent=${verdict.percent}\n`);
    }
    if (verdict.result === "passed") {
        console.log(`::notice title=Coverage::${verdict.message}`);
        return;
    }
    console.log(`::error title=Coverage::${verdict.message}`);
    process.exit(1);
}
if (import.meta.main) {
    main();
}
/* eslint-enable no-console */
//# sourceMappingURL=coverage-check.js.map