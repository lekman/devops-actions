/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Findings producer for the `audit` jobs. Parses the JSON of four
 * dependency auditors into one markdown summary for embedding inside the
 * Security Gate <details> body:
 *
 *   pip-audit      Python (python-audit)
 *   osv-scanner    Gradle lockfiles and Maven poms (jvm-audit)
 *   dotnet         `dotnet package list --vulnerable` (dotnet-audit)
 *   cargo-audit    Cargo.lock against the RustSec database (rust-audit)
 *
 * Three outcomes, kept distinct on purpose:
 *
 *   clean          the tool ran and found nothing
 *   vulnerable     the tool ran and found advisories
 *   indeterminate  the tool did not run, or its output could not be read
 *
 * The third is why this module exists rather than reusing a boolean. A zero
 * vulnerability count from a tool that never ran looks exactly like a clean
 * audit, and it is the shape a false green takes.
 *
 * pip-audit reports no severity — verified against 2.10.1, whose vuln
 * records carry only `id`, `fix_versions`, `aliases` and `description`. No
 * severity is invented here; the advisory id and the fixed version are what
 * the tool actually knows. OSV-Scanner reports a CVSS score per advisory
 * group and the .NET SDK a severity word, and those are shown when present.
 */
export interface Advisory {
    /** Distribution name, e.g. "urllib3". */
    package: string;
    /** Installed version the advisory applies to. */
    version: string;
    /** Advisory identifier, e.g. "PYSEC-2019-133". */
    id: string;
    /** First version carrying the fix, when the advisory names one. */
    fixVersion?: string;
    /**
     * False when the tool does not report fixed versions at all, as the .NET
     * SDK's audit does not, so an empty `fixVersion` says nothing about
     * whether a fix exists.
     */
    fixReported?: boolean;
    /** Advisory summary, truncated for the table. */
    description: string;
    /** GitHub advisory link, when an alias supplies one. */
    url?: string;
}
export type AuditOutcome = {
    status: "clean";
    packagesScanned: number;
} | {
    status: "vulnerable";
    packagesScanned: number;
    advisories: Advisory[];
    total: number;
} | {
    status: "indeterminate";
    reason: string;
};
/**
 * Parse pip-audit JSON output.
 *
 * @param json Raw stdout from `pip-audit --format json`.
 * @returns The outcome, `indeterminate` when the output is not pip-audit's.
 */
export declare function parsePipAudit(json: string): AuditOutcome;
/**
 * Compare two version strings by their numeric parts, which is enough to
 * pick the nearest fixed version for Maven-style versions. Qualifiers such
 * as `-rc1` sort before the release they precede.
 */
export declare function compareVersions(a: string, b: string): number;
/**
 * Parse `osv-scanner scan source --all-packages --format json` output.
 *
 * Verified against OSV-Scanner 2.7.1. Each scanned file is a `results`
 * entry with its `packages`; `--all-packages` lists every package, not only
 * the vulnerable ones, so the count of scanned packages is real. A package
 * with advisories carries `groups`, one per advisory once aliases are
 * merged, each with a `max_severity` CVSS score, and the `vulnerabilities`
 * records with the summary and the fixed versions.
 *
 * @param json Raw stdout from OSV-Scanner.
 */
export declare function parseOsvScanner(json: string): AuditOutcome;
/**
 * Parse the .NET SDK's package audit.
 *
 * Verified against SDK 11.0.100. `dotnet package list --vulnerable
 * --include-transitive --format json` lists only vulnerable packages, each
 * with a severity word and an advisory URL and no fixed version. The count
 * of scanned packages comes from a second listing without `--vulnerable`,
 * when the caller has one.
 *
 * @param vulnerableJson Output of the `--vulnerable` listing.
 * @param allJson Output of the same listing without `--vulnerable`, or
 *   undefined when it is not available.
 */
export declare function parseDotnetPackageList(vulnerableJson: string, allJson?: string): AuditOutcome;
/**
 * Parse `cargo audit --json` output.
 *
 * Read against the report types of rustsec at cargo-audit/v0.23.0
 * (rustsec/src/report.rs). `lockfile.dependency-count` is the number of
 * packages in Cargo.lock, and `vulnerabilities.list` holds one entry per
 * advisory and affected package. Informational advisories (unmaintained,
 * unsound, yanked) are `warnings`, which cargo-audit itself does not fail
 * on, so they are not counted here either.
 *
 * @param json Raw stdout from cargo-audit.
 */
export declare function parseCargoAudit(json: string): AuditOutcome;
/**
 * Render an audit outcome as markdown for the gate comment.
 *
 * @param outcome Parsed audit result.
 * @returns Markdown, never empty — an audit that did not run still reports.
 */
export declare function formatAuditFindings(outcome: AuditOutcome): string;
export type AuditFormat = "pip-audit" | "osv-scanner" | "dotnet" | "cargo-audit";
/**
 * Read an auditor's result file into an outcome. A missing or unreadable
 * file is indeterminate, never clean.
 *
 * @param format Which auditor wrote the file.
 * @param jsonPath Path to its JSON output.
 * @param allJsonPath dotnet only: the listing without `--vulnerable`.
 */
export declare function readAuditResult(format: AuditFormat, jsonPath: string | undefined, allJsonPath?: string): AuditOutcome;
