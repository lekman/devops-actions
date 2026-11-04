/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Test data builders for devops-actions tests.
 * Each builder returns a valid default instance that can be overridden
 * with partial properties. Use these instead of constructing test data
 * inline — keeps tests focused on what varies.
 */

import type { GateInput } from "../../src/quality-gate";
import type { BranchStatus, PullRequest } from "../../src/branch-maintenance";

/**
 * Build a {@link GateInput} with sensible defaults.
 * Override only the fields relevant to your test case.
 */
export function aGateInput(overrides?: Partial<GateInput>): GateInput {
  return {
    required: ["quality", "security"],
    results: { quality: "success", security: "success" },
    ...overrides,
  };
}

/**
 * Build a {@link BranchStatus} with sensible defaults.
 * Default is a clean, up-to-date branch with no conflicts.
 */
export function aBranchStatus(overrides?: Partial<BranchStatus>): BranchStatus {
  return {
    repo: "lekman/test-repo",
    pr: 1,
    head: "feat/x",
    base: "main",
    behindBy: 0,
    conflicting: false,
    ...overrides,
  };
}

/**
 * Build a {@link PullRequest} with sensible defaults.
 * Default is a mergeable, non-draft PR without auto-merge.
 */
export function aPullRequest(overrides?: Partial<PullRequest>): PullRequest {
  return {
    number: 1,
    nodeId: "PR_abc123",
    headRefName: "feat/x",
    baseRefName: "main",
    isDraft: false,
    autoMergeEnabled: false,
    mergeable: "MERGEABLE",
    ...overrides,
  };
}
