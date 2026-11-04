/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Findings producer for the `audit` job. Parses pip-audit JSON into a
 * markdown summary for embedding inside the Security Gate <details> body.
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
 * the tool actually knows.
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
 * Render an audit outcome as markdown for the gate comment.
 *
 * @param outcome Parsed audit result.
 * @returns Markdown, never empty — an audit that did not run still reports.
 */
export declare function formatAuditFindings(outcome: AuditOutcome): string;
