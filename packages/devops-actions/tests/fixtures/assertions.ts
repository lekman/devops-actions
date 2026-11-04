/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Fluent assertion helpers for devops-actions tests.
 * Wraps bun:test expect() with domain-specific chainable assertions.
 * Reduces noise in test bodies — focus on what you're testing, not how.
 */

import { expect } from "bun:test";
import { evaluate } from "../../src/quality-gate";
import type { GateInput } from "../../src/quality-gate";
import { classifyBranch } from "../../src/branch-maintenance";
import type { BranchStatus, BranchAction } from "../../src/branch-maintenance";

/**
 * Fluent assertions for quality gate evaluation.
 * Usage: `expectGate(input).toPass()` or `expectGate(input).toFailWith("quality")`
 */
export function expectGate(input: GateInput) {
  const result = evaluate(input);
  return {
    toPass: () => {
      expect(result.pass).toBe(true);
      expect(result.failures).toHaveLength(0);
      return this;
    },
    toFail: () => {
      expect(result.pass).toBe(false);
      return this;
    },
    toFailWith: (...jobs: string[]) => {
      expect(result.pass).toBe(false);
      for (const job of jobs) {
        expect(result.failures.some((f) => f.startsWith(job))).toBe(true);
      }
    },
  };
}

/**
 * Fluent assertions for branch classification.
 * Usage: `expectBranch(status).toBeClassifiedAs("updated")`
 */
export function expectBranch(status: BranchStatus) {
  return {
    toBeClassifiedAs: (expected: BranchAction) => {
      expect(classifyBranch(status)).toBe(expected);
    },
  };
}
