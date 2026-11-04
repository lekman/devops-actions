/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */
export declare function kbUrlForJob(jobName: string): string;
/**
 * Fetches the jobs for the current workflow run and returns a map from
 * display name (and a few common variants) to the job's html_url. Used to
 * deep-link each check's "View run" to its specific job instead of the run
 * overview. Returns an empty map on any failure — the gate falls back to
 * the run URL silently.
 */
export declare function fetchJobUrls(token?: string): Promise<Map<string, string>>;
export interface GateInput {
    /** Jobs that must succeed unconditionally. */
    required: string[];
    /** Jobs that must succeed only when infra-changed is "true". */
    requiredWhenInfraChanged?: string[];
    /** Jobs that must succeed when they run, but are OK when skipped. */
    conditional?: string[];
    /** Job name → GitHub Actions result string. */
    results: Record<string, string>;
    /**
     * Optional named sections in the PR comment. Keys are the H2 heading
     * to render (e.g. "Security Gate"); values are the job names that
     * belong to that section. Jobs not listed in any group render under
     * the default "Quality Gate" section.
     */
    groups?: Record<string, string[]>;
}
export declare function evaluate(input: GateInput): {
    pass: boolean;
    failures: string[];
};
export type Mode = "start" | "final";
export interface SummaryOptions {
    jobUrls?: Map<string, string>;
    findingsDir?: string;
    dependabotBlock?: string;
    /** Pre-built support request URL. Shown above the footer when the gate fails. */
    supportUrl?: string;
}
export declare function formatSummary(input: GateInput, result: {
    pass: boolean;
    failures: string[];
}, mode?: Mode, options?: SummaryOptions): string;
/**
 * Fetch open high/critical Dependabot alerts. Returns a markdown block
 * for embedding after the Security Gate section. Informational only —
 * never affects gate pass/fail. Returns empty string on any failure.
 */
export declare function fetchDependabotAlerts(token: string | undefined, repo: string | undefined): Promise<string>;
