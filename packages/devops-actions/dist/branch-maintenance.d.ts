/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Branch Maintenance — keeps PR branches up to date with their base branch.
 *
 * Scans open PRs across an org (or a single repo), detects stale or
 * conflicted branches, and takes action: auto-updates stale branches
 * (triggering fresh CI) and comments on conflicted ones.
 *
 * Uses the GitHub compare API to detect behind_by count — this works
 * regardless of branch protection settings, unlike mergeable_state which
 * only reports "behind" when "require up to date" is enabled.
 */
export interface PullRequest {
    number: number;
    headRefName: string;
    baseRefName: string;
    isDraft: boolean;
    mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
    autoMergeEnabled: boolean;
    nodeId: string;
}
export interface BranchStatus {
    repo: string;
    pr: number;
    head: string;
    base: string;
    behindBy: number;
    conflicting: boolean;
}
export type BranchAction = "updated" | "conflicted" | "clean" | "auto-merge" | "error";
export interface MaintenanceResult {
    repo: string;
    pr: number;
    action: BranchAction;
    detail: string;
}
export interface MaintenanceSummary {
    updated: number;
    conflicted: number;
    clean: number;
    "auto-merge": number;
    errors: number;
    results: MaintenanceResult[];
}
export declare function classifyBranch(status: BranchStatus): BranchAction;
export declare function formatConflictComment(base: string): string;
export declare function summarise(results: MaintenanceResult[]): MaintenanceSummary;
export declare function fetchOrgRepos(org: string, token: string): Promise<string[]>;
export declare function fetchOpenPRs(repo: string, token: string): Promise<PullRequest[]>;
export declare function getBranchStatus(repo: string, pr: PullRequest, token: string): Promise<BranchStatus>;
export declare function updateBranch(repo: string, prNumber: number, token: string): Promise<boolean>;
export declare function commentOnPR(repo: string, prNumber: number, body: string, token: string): Promise<void>;
export declare function enableAutoMerge(nodeId: string, token: string): Promise<boolean>;
export declare function processPR(repo: string, pr: PullRequest, token: string): Promise<MaintenanceResult>;
export declare function maintainRepo(repo: string, token: string): Promise<MaintenanceResult[]>;
export declare function maintainOrg(org: string, token: string): Promise<MaintenanceSummary>;
