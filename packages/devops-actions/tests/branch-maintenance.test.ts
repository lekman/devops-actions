/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */

import { describe, expect, test } from "bun:test";
import { formatConflictComment, summarise } from "../src/branch-maintenance";
import type { MaintenanceResult } from "../src/branch-maintenance";
import { expectBranch } from "./fixtures/assertions";
import { aBranchStatus } from "./fixtures/builders";

// ─── classifyBranch ──────────────────────────────────────────────────────

describe("classifyBranch", () => {
  test.each([
    ["clean when up to date", aBranchStatus(), "clean"],
    ["updated when behind", aBranchStatus({ behindBy: 5 }), "updated"],
    [
      "conflicted when conflicts",
      aBranchStatus({ conflicting: true }),
      "conflicted",
    ],
    [
      "conflicted even when also behind",
      aBranchStatus({ behindBy: 3, conflicting: true }),
      "conflicted",
    ],
  ] as const)("%s", (_, status, expected) => {
    expectBranch(status).toBeClassifiedAs(expected);
  });
});

// ─── formatConflictComment ───────────────────────────────────────────────

describe("formatConflictComment", () => {
  test.each([
    ["main", "`main`"],
    ["develop", "Merge conflict detected"],
  ])("comment for base %s contains %s", (base, expected) => {
    expect(formatConflictComment(base)).toContain(expected);
  });
});

// ─── summarise ───────────────────────────────────────────────────────────

describe("summarise", () => {
  test("counts each action type", () => {
    const results: MaintenanceResult[] = [
      { repo: "a", pr: 1, action: "updated", detail: "" },
      { repo: "a", pr: 2, action: "updated", detail: "" },
      { repo: "b", pr: 3, action: "conflicted", detail: "" },
      { repo: "c", pr: 4, action: "clean", detail: "" },
      { repo: "c", pr: 5, action: "clean", detail: "" },
      { repo: "c", pr: 6, action: "clean", detail: "" },
      { repo: "d", pr: 7, action: "error", detail: "" },
    ];
    const s = summarise(results);
    expect(s.updated).toBe(2);
    expect(s.conflicted).toBe(1);
    expect(s.clean).toBe(3);
    expect(s.errors).toBe(1);
  });

  test("handles empty results", () => {
    const s = summarise([]);
    expect(s.updated).toBe(0);
    expect(s.conflicted).toBe(0);
    expect(s.clean).toBe(0);
    expect(s.errors).toBe(0);
  });
});
