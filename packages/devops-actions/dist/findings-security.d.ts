/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Findings producer for the `security` job. Parses Semgrep JSON output
 * and writes a markdown summary with a findings table for embedding
 * inside the Security Gate <details> body.
 *
 * Severity sort: ERROR > WARNING > INFO.
 * Capped at 20 rows; links to the full SARIF artifact when available.
 */
export interface SemgrepResult {
    check_id: string;
    path: string;
    start: {
        line: number;
        col: number;
    };
    end: {
        line: number;
        col: number;
    };
    extra: {
        message: string;
        severity: string;
        metadata?: Record<string, unknown>;
    };
}
export interface SemgrepOutput {
    results: SemgrepResult[];
    errors: unknown[];
    version?: string;
}
export interface SecurityFinding {
    rule: string;
    file: string;
    severity: string;
    message: string;
    reference: string;
}
export interface GitleaksResult {
    Description: string;
    File: string;
    StartLine: number;
    RuleID: string;
    Match?: string;
}
/**
 * Parse Semgrep JSON output into a sorted, capped list of findings.
 */
export declare function parseSemgrepJson(json: string): SecurityFinding[];
/**
 * Parse Gitleaks JSON output into findings.
 */
export declare function parseGitleaksJson(json: string): SecurityFinding[];
export declare function formatSecurityFindings(semgrepFindings: SecurityFinding[], semgrepTotal: number, gitleaksFindings?: SecurityFinding[], gitleaksTotal?: number): string;
