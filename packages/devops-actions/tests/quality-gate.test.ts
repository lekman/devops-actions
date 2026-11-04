/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate, formatSummary, kbUrlForJob } from "../src/quality-gate";
import { expectGate } from "./fixtures/assertions";
import { aGateInput } from "./fixtures/builders";

describe("evaluate", () => {
  test.each([
    ["all pass", aGateInput()],
    [
      "skipped optional",
      aGateInput({
        results: {
          quality: "success",
          security: "success",
          "trunk-check": "skipped",
        },
      }),
    ],
  ])("passes when %s", (_, input) => {
    expectGate(input).toPass();
  });

  test.each([
    [
      "required job fails",
      aGateInput({ results: { quality: "failure", security: "success" } }),
      "quality",
    ],
    [
      "required job missing",
      aGateInput({ results: { security: "success" } }),
      "quality",
    ],
    [
      "required job cancelled",
      aGateInput({ results: { quality: "cancelled", security: "success" } }),
      "quality",
    ],
  ])("fails when %s", (_, input, failJob) => {
    expectGate(input).toFailWith(failJob);
  });

  test("fails multiple jobs", () => {
    expectGate(
      aGateInput({ results: { quality: "failure", security: "failure" } }),
    ).toFailWith("quality", "security");
  });

  test("requiredWhenInfraChanged checks pass when infra unchanged", () => {
    expectGate(
      aGateInput({
        requiredWhenInfraChanged: ["preview"],
        results: {
          quality: "success",
          security: "success",
          "infra-changed": "false",
          preview: "skipped",
        },
      }),
    ).toPass();
  });

  test("requiredWhenInfraChanged checks fail when infra changed and job fails", () => {
    expectGate(
      aGateInput({
        requiredWhenInfraChanged: ["preview"],
        results: {
          quality: "success",
          security: "success",
          "infra-changed": "true",
          preview: "failure",
        },
      }),
    ).toFailWith("preview");
  });

  test.each([
    ["conditional job succeeds", "success"],
    ["conditional job skipped", "skipped"],
  ])("passes when %s", (_, result) => {
    expectGate(
      aGateInput({
        conditional: ["deliver", "deploy", "verify"],
        results: {
          quality: "success",
          security: "success",
          deliver: result,
          deploy: result,
          verify: result,
        },
      }),
    ).toPass();
  });

  test("fails when conditional job fails", () => {
    expectGate(
      aGateInput({
        conditional: ["deliver", "deploy"],
        results: {
          quality: "success",
          security: "success",
          deliver: "success",
          deploy: "failure",
        },
      }),
    ).toFailWith("deploy");
  });

  test("fails when conditional job is cancelled", () => {
    expectGate(
      aGateInput({
        conditional: ["deliver"],
        results: {
          quality: "success",
          security: "success",
          deliver: "cancelled",
        },
      }),
    ).toFailWith("deliver");
  });
});

describe("kbUrlForJob", () => {
  test.each([
    ["quality", "quality-gate.md"],
    ["security", "security.md"],
    ["trunk-check", "trunk.md"],
    ["infra-preview", "infra.md"],
  ])("maps %s to %s", (job, expectedPage) => {
    expect(kbUrlForJob(job)).toBe(
      `https://github.com/lekman/devops-actions/blob/main/docs/kb/${expectedPage}`,
    );
  });

  test("falls back to quality-gate.md for unknown jobs", () => {
    expect(kbUrlForJob("unknown-job")).toContain("quality-gate.md");
  });
});

describe("formatSummary", () => {
  test("shows PASSED for passing gate", () => {
    const input = aGateInput();
    const result = evaluate(input);
    const md = formatSummary(input, result);
    expect(md).toContain("🟢 **PASSED**");
    // No <details open> when nothing failed
    expect(md).not.toContain("<details open>");
  });

  test("shows FAILED with count for failing gate", () => {
    const input = aGateInput({
      required: ["quality"],
      conditional: ["trunk-check", "deliver"],
      results: {
        quality: "failure",
        "trunk-check": "skipped",
        deliver: "success",
      },
    });
    const result = evaluate(input);
    const md = formatSummary(input, result);
    expect(md).toContain("🔴 **FAILED**");
    expect(md).toContain("1 of 3 checks failed");
  });

  test("renders each job with correct emoji", () => {
    const input = aGateInput({
      required: ["quality"],
      conditional: ["trunk-check", "deliver"],
      results: {
        quality: "success",
        "trunk-check": "skipped",
        deliver: "failure",
      },
    });
    const result = evaluate(input);
    const md = formatSummary(input, result);
    expect(md).toContain("🟢");
    expect(md).toContain("⚪");
    expect(md).toContain("🔴");
  });

  test("omits the summary table (info lives in <details> blocks)", () => {
    const input = aGateInput({
      required: ["quality"],
      conditional: ["trunk-check"],
      results: { quality: "failure", "trunk-check": "success" },
    });
    const result = evaluate(input);
    const md = formatSummary(input, result);
    expect(md).not.toContain("| Check | Status |");
    expect(md).not.toContain("|---|---|---|---|");
  });

  test("renders KB link inside every <details> body", () => {
    const input = aGateInput({
      required: ["quality"],
      conditional: ["trunk-check"],
      results: { quality: "failure", "trunk-check": "success" },
    });
    const result = evaluate(input);
    const md = formatSummary(input, result);
    // One KB link per <details> block
    const kbMatches = md.match(/\[KB\]\(/g);
    expect(kbMatches).toHaveLength(2);
  });

  test("uses human-readable labels for known jobs", () => {
    const input = aGateInput({
      required: ["quality"],
      conditional: ["deliver", "deploy", "verify"],
      results: {
        quality: "success",
        deliver: "skipped",
        deploy: "skipped",
        verify: "skipped",
      },
    });
    const result = evaluate(input);
    const md = formatSummary(input, result);
    expect(md).toContain("QA: Build, Typecheck, Test");
    expect(md).toContain("CI/CD: Continuous Delivery");
    expect(md).toContain("CI/CD: Continuous Deployment");
    expect(md).toContain("QA: GAMP5 Verification");
  });

  test("falls back to job name for unknown jobs", () => {
    const input = aGateInput({
      required: ["custom-job"],
      results: { "custom-job": "success" },
    });
    const result = evaluate(input);
    const md = formatSummary(input, result);
    expect(md).toContain("<b>custom-job</b>");
  });

  test("renders auto-open <details> for failed checks with hint and combined links", () => {
    const input = aGateInput({
      required: ["quality"],
      results: { quality: "failure" },
    });
    const result = evaluate(input);
    const md = formatSummary(input, result);
    expect(md).toContain("<details open>");
    expect(md).toContain("build, typecheck, and test:coverage");
    // Quality has KB + three related links merged into one "Troubleshooting:" line
    expect(md).toMatch(
      /\*\*Troubleshooting:\*\* \[KB\]\([^)]+\) · \[Build\]\([^)]+\) · \[Typecheck\]\([^)]+\) · \[Tests\]\([^)]+\)/,
    );
    // "Related KB:" label removed (merged into the Troubleshooting line)
    expect(md).not.toContain("**Related KB:**");
  });

  test("renders collapsed <details> for passing checks", () => {
    const input = aGateInput({
      required: ["quality"],
      results: { quality: "success", security: "success" },
    });
    const result = evaluate(input);
    const md = formatSummary(input, result);
    expect(md).toContain("<details>");
    expect(md).not.toContain("<details open>");
  });

  test("marks required vs conditional in each <details> summary", () => {
    const input = aGateInput({
      required: ["quality"],
      conditional: ["deliver"],
      results: { quality: "success", deliver: "success" },
    });
    const result = evaluate(input);
    const md = formatSummary(input, result);
    expect(md).toMatch(/· Required.*<\/summary>/);
    expect(md).toMatch(/· Conditional.*<\/summary>/);
  });

  test("includes 'View workflow run' header link and per-check 'View run' anchor when GitHub run env is set", () => {
    process.env.GITHUB_SERVER_URL = "https://github.com";
    process.env.GITHUB_REPOSITORY = "lekman/devops-toolkit";
    process.env.GITHUB_RUN_ID = "12345";
    try {
      const md = formatSummary(aGateInput(), evaluate(aGateInput()));
      const expectedRun =
        "https://github.com/lekman/devops-toolkit/actions/runs/12345";
      expect(md).toContain(`[View workflow run](${expectedRun})`);
      expect(md).toContain(`<a href="${expectedRun}">View run</a>`);
    } finally {
      delete process.env.GITHUB_SERVER_URL;
      delete process.env.GITHUB_REPOSITORY;
      delete process.env.GITHUB_RUN_ID;
    }
  });

  test("per-check 'View run' deep-links to the specific job when jobUrls provided", () => {
    process.env.GITHUB_SERVER_URL = "https://github.com";
    process.env.GITHUB_REPOSITORY = "lekman/devops-toolkit";
    process.env.GITHUB_RUN_ID = "24430836477";
    try {
      const input = aGateInput({
        required: ["quality"],
        results: { quality: "success" },
      });
      const jobUrls = new Map([
        [
          "QA: Build, Typecheck, Test",
          "https://github.com/lekman/devops-toolkit/actions/runs/24430836477/job/71374866075",
        ],
      ]);
      const md = formatSummary(input, evaluate(input), "final", { jobUrls });
      // Per-check link points to the specific job
      expect(md).toContain(
        '<a href="https://github.com/lekman/devops-toolkit/actions/runs/24430836477/job/71374866075">View run</a>',
      );
      // Header still links to the run overview, not the job
      expect(md).toContain(
        "[View workflow run](https://github.com/lekman/devops-toolkit/actions/runs/24430836477)",
      );
    } finally {
      delete process.env.GITHUB_SERVER_URL;
      delete process.env.GITHUB_REPOSITORY;
      delete process.env.GITHUB_RUN_ID;
    }
  });

  test("omits 'View workflow run' link when GitHub run env is missing", () => {
    delete process.env.GITHUB_SERVER_URL;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_RUN_ID;
    const md = formatSummary(aGateInput(), evaluate(aGateInput()));
    expect(md).not.toContain("View workflow run");
    expect(md).not.toContain("View run</a>");
  });

  test("start mode renders IN PROGRESS header and pending rows", () => {
    const input = aGateInput({
      required: ["quality", "security"],
      conditional: ["trunk-check"],
      results: {},
    });
    const md = formatSummary(input, { pass: true, failures: [] }, "start");
    expect(md).toContain("🔘 **IN PROGRESS**");
    expect(md).not.toContain("Started at");
    expect(md).not.toContain("🟢 **PASSED**");
    expect(md).not.toContain("🔴 **FAILED**");
    // Every row in pending state
    const pendingRows = md.match(/🔘 <b>/g);
    expect(pendingRows).toHaveLength(3);
    // All <details> collapsed (no auto-open) in start mode
    expect(md).not.toContain("<details open>");
  });

  test("renders Dependabot alerts block when provided", () => {
    const dependabotBlock = [
      "<details>",
      "<summary>🟡 <b>Dependabot</b> — 2 open alerts</summary>",
      "| Dependency | Severity |",
      "|------------|----------|",
      "| lodash | CRITICAL |",
      "</details>",
    ].join("\n");
    const input = aGateInput();
    const md = formatSummary(input, evaluate(input), "final", {
      dependabotBlock,
    });
    expect(md).toContain("🟡 <b>Dependabot</b>");
    expect(md).toContain("| lodash | CRITICAL |");
    // Block appears before the footer
    expect(md.indexOf("Dependabot")).toBeLessThan(md.indexOf("## \n\n<sub>"));
  });

  test("omits Dependabot block when empty string", () => {
    const md = formatSummary(aGateInput(), evaluate(aGateInput()));
    expect(md).not.toContain("Dependabot");
  });

  test("shows Request Support link above footer when gate fails", () => {
    const input = aGateInput({
      required: ["quality"],
      results: { quality: "failure" },
    });
    const result = evaluate(input);
    const url =
      "https://github.com/org/repo/issues/new?template=request-support.md";
    const md = formatSummary(input, result, "final", { supportUrl: url });
    expect(md).toContain(`[Request Support](${url})`);
    // Link is above the footer
    expect(md.indexOf("Request Support")).toBeLessThan(
      md.indexOf("## \n\n<sub>"),
    );
  });

  test("omits Request Support link when gate passes", () => {
    const input = aGateInput();
    const url =
      "https://github.com/org/repo/issues/new?template=request-support.md";
    const md = formatSummary(input, evaluate(input), "final", {
      supportUrl: url,
    });
    expect(md).not.toContain("Request Support");
  });

  test("omits Request Support link in start mode", () => {
    const input = aGateInput({ required: ["quality"], results: {} });
    const url =
      "https://github.com/org/repo/issues/new?template=request-support.md";
    const md = formatSummary(input, { pass: true, failures: [] }, "start", {
      supportUrl: url,
    });
    expect(md).not.toContain("Request Support");
  });

  test("footer has empty H2 divider then version and timestamp only", () => {
    const md = formatSummary(aGateInput(), evaluate(aGateInput()));
    // Empty "## " on its own line provides the thin H2 underline (subtle HR)
    expect(md).toContain("\n## \n\n<sub>");
    // Version is "dev" when running the TS source directly
    expect(md).toMatch(/<sub>dev · /);
    // Timestamp is formatted as "YYYY-MM-DD HH:MM:SS UTC" (default TZ), not raw ISO
    expect(md).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/);
    expect(md).not.toMatch(/\dT\d\d:\d\d:\d\d\.\d+Z/);
    // KB index link is no longer in the footer
    expect(md).not.toContain("[KB index]");
    // No bold `---` HR
    expect(md).not.toContain("\n---\n");
  });

  test("renders timestamp in the configured timezone when QUALITY_GATE_TIMEZONE is set", () => {
    process.env.QUALITY_GATE_TIMEZONE = "Europe/Stockholm";
    try {
      const md = formatSummary(aGateInput(), evaluate(aGateInput()));
      expect(md).toContain("Europe/Stockholm");
      expect(md).toMatch(
        /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} Europe\/Stockholm/,
      );
    } finally {
      delete process.env.QUALITY_GATE_TIMEZONE;
    }
  });

  test("falls back to ISO UTC when QUALITY_GATE_TIMEZONE is invalid", () => {
    process.env.QUALITY_GATE_TIMEZONE = "Not/A/Zone";
    try {
      const md = formatSummary(aGateInput(), evaluate(aGateInput()));
      // Falls back to ISO 8601 format
      expect(md).toMatch(/\dT\d\d:\d\d:\d\d\.\d+Z/);
    } finally {
      delete process.env.QUALITY_GATE_TIMEZONE;
    }
  });

  test("embeds findings markdown inside the matching <details> body when findings-dir is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "findings-"));
    writeFileSync(
      join(dir, "quality.md"),
      "**42/42 tests passed** · 92.3% lines covered\n",
    );
    const input = aGateInput({
      required: ["quality", "security"],
      results: { quality: "success", security: "success" },
    });
    const md = formatSummary(input, evaluate(input), "final", {
      findingsDir: dir,
    });
    // Findings appear inside the quality <details>, before the Troubleshooting line
    expect(md).toContain("**42/42 tests passed** · 92.3% lines covered");
    const qualityBlock = md.slice(
      md.indexOf("QA: Build, Typecheck, Test"),
      md.indexOf("</details>", md.indexOf("QA:")),
    );
    expect(qualityBlock).toContain("**42/42 tests passed**");
    expect(qualityBlock.indexOf("**42/42 tests passed**")).toBeLessThan(
      qualityBlock.indexOf("**Troubleshooting:**"),
    );
  });

  test("missing findings file is silently skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "findings-"));
    writeFileSync(join(dir, "quality.md"), "quality findings here\n");
    const input = aGateInput({
      required: ["quality", "security"],
      results: { quality: "success", security: "success" },
    });
    const md = formatSummary(input, evaluate(input), "final", {
      findingsDir: dir,
    });
    // quality has findings, security does not — no error, just no embed
    expect(md).toContain("quality findings here");
    const securityBlock = md.slice(
      md.indexOf("Security: SAST & Secret Detection"),
      md.indexOf("</details>", md.indexOf("Security:")),
    );
    expect(securityBlock).not.toContain("quality findings here");
    // Security still has its standard hint and KB link
    expect(securityBlock).toContain("Semgrep SAST");
    expect(securityBlock).toContain("Gitleaks secret detection");
    expect(securityBlock).toContain("**Troubleshooting:**");
  });

  test("findings are not embedded in start (placeholder) mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "findings-"));
    writeFileSync(join(dir, "quality.md"), "stale findings from previous run");
    const input = aGateInput({
      required: ["quality"],
      results: {},
    });
    const md = formatSummary(input, { pass: true, failures: [] }, "start", {
      findingsDir: dir,
    });
    // Placeholder must not embed findings — they're meaningless before checks run
    expect(md).not.toContain("stale findings from previous run");
  });

  test("findings-dir defaults to QUALITY_GATE_FINDINGS_DIR env when unset", () => {
    const dir = mkdtempSync(join(tmpdir(), "findings-"));
    writeFileSync(join(dir, "quality.md"), "from env var");
    process.env.QUALITY_GATE_FINDINGS_DIR = dir;
    try {
      const input = aGateInput({
        required: ["quality"],
        results: { quality: "success" },
      });
      const md = formatSummary(input, evaluate(input));
      expect(md).toContain("from env var");
    } finally {
      delete process.env.QUALITY_GATE_FINDINGS_DIR;
    }
  });

  test("renders a separate Security Gate section when groups is provided", () => {
    const input = aGateInput({
      required: ["quality", "security"],
      conditional: ["trunk-check"],
      groups: { "Security Gate": ["security"] },
      results: {
        quality: "success",
        security: "success",
        "trunk-check": "success",
      },
    });
    const md = formatSummary(input, evaluate(input));
    // Both section headings present
    expect(md).toContain("## Quality Gate\n");
    expect(md).toContain("## Security Gate\n");
    // Quality Gate section comes before Security Gate section
    expect(md.indexOf("## Quality Gate\n")).toBeLessThan(
      md.indexOf("## Security Gate\n"),
    );
    // Security section contains the security job, not quality
    const securityIdx = md.indexOf("## Security Gate\n");
    const footerIdx = md.lastIndexOf("## \n\n<sub>");
    const securityBlock = md.slice(securityIdx, footerIdx);
    expect(securityBlock).toContain("Security: SAST & Secret Detection");
    expect(securityBlock).not.toContain("QA: Build, Typecheck, Test");
    // No extra HR between sections — the H2 heading provides its own border
    expect(md).not.toMatch(/<\/details>\n\n## \n\n## Security Gate/);
    expect(md).toMatch(/<\/details>\n\n## Security Gate/);
  });

  test("Security Gate section shows its own FAILED status when only security fails", () => {
    const input = aGateInput({
      required: ["quality", "security"],
      groups: { "Security Gate": ["security"] },
      results: { quality: "success", security: "failure" },
    });
    const md = formatSummary(input, evaluate(input));
    // Quality Gate PASSED, Security Gate FAILED — each computed from its own jobs
    const qualityHeader = md.slice(
      md.indexOf("## Quality Gate"),
      md.indexOf("## Security Gate"),
    );
    const securityHeader = md.slice(md.indexOf("## Security Gate"));
    expect(qualityHeader).toContain("🟢 **PASSED**");
    expect(securityHeader).toContain("🔴 **FAILED**");
  });

  test("shows CANCELLED (yellow) when any required job was cancelled and keeps all <details> collapsed", () => {
    const input = aGateInput({
      required: ["quality", "security"],
      results: { quality: "cancelled", security: "success" },
    });
    const result = evaluate(input);
    const md = formatSummary(input, result);
    expect(md).toContain("🟡 **CANCELLED**");
    expect(md).not.toContain("🔴 **FAILED**");
    // Cancelled jobs must NOT auto-expand — a half-finished run is not actionable
    expect(md).not.toContain("<details open>");
    // Exit code is still non-zero (gate still fails) — that's evaluate()'s job
    expect(result.pass).toBe(false);
  });

  test("shows FAILED (red) when a required job failed without cancellation", () => {
    const input = aGateInput({
      required: ["quality"],
      results: { quality: "failure" },
    });
    const result = evaluate(input);
    const md = formatSummary(input, result);
    expect(md).toContain("🔴 **FAILED**");
    expect(md).not.toContain("🟡 **CANCELLED**");
  });

  test("contains marker comment for upsert", () => {
    const input = aGateInput();
    const result = evaluate(input);
    const md = formatSummary(input, result);
    expect(md).toContain("<!-- quality-gate -->");
  });

  test("deduplicates jobs across required and conditional", () => {
    const input = aGateInput({
      required: ["quality"],
      conditional: ["quality", "deliver"],
      results: { quality: "success", deliver: "success" },
    });
    const result = evaluate(input);
    const md = formatSummary(input, result);
    // quality should appear only once in the table
    const qualityMatches = md.match(/QA: Build, Typecheck, Test/g);
    // Once in <details> summary (table removed)
    expect(qualityMatches).toHaveLength(1);
  });
});
