/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */

import { describe, expect, test } from "bun:test";
import {
  formatSecurityFindings,
  parseGitleaksJson,
  parseSemgrepJson,
} from "../src/findings-security";

const SAMPLE_JSON = JSON.stringify({
  results: [
    {
      check_id: "p/typescript.sql-injection",
      path: "src/db.ts",
      start: { line: 42, col: 5 },
      end: { line: 42, col: 30 },
      extra: {
        message: "Possible SQL injection via string concatenation.",
        severity: "ERROR",
        metadata: {
          references: ["https://owasp.org/sql-injection"],
        },
      },
    },
    {
      check_id: "p/secrets.hardcoded-password",
      path: "src/config.ts",
      start: { line: 10, col: 1 },
      end: { line: 10, col: 20 },
      extra: {
        message: "Hardcoded password detected in source code.",
        severity: "WARNING",
        metadata: {
          source: "https://semgrep.dev/r/p/secrets.hardcoded-password",
        },
      },
    },
    {
      check_id: "p/security-audit.open-redirect",
      path: "src/auth.ts",
      start: { line: 88, col: 3 },
      end: { line: 88, col: 50 },
      extra: {
        message: "Unvalidated redirect URL from user input.",
        severity: "ERROR",
      },
    },
  ],
  errors: [],
  version: "1.99.0",
});

describe("parseSemgrepJson", () => {
  test("parses results and sorts by severity (ERROR first)", () => {
    const findings = parseSemgrepJson(SAMPLE_JSON);
    expect(findings).toHaveLength(3);
    // ERRORs come first
    expect(findings[0].severity).toBe("ERROR");
    expect(findings[1].severity).toBe("ERROR");
    expect(findings[2].severity).toBe("WARNING");
  });

  test("extracts shortened rule, file:line, severity, message, reference", () => {
    const findings = parseSemgrepJson(SAMPLE_JSON);
    const first = findings[0];
    // Rule shortened from "p/security-audit.open-redirect" → "open-redirect"
    // (sorted by severity then file, so auth.ts comes before db.ts)
    expect(first.file).toBe("src/auth.ts:88");
    expect(first.rule).toBe("open-redirect");
    expect(first.message).toContain("Unvalidated redirect");
    // No metadata.references on this finding
    expect(first.reference).toBe("");

    // Second ERROR finding has references array
    const sqlInj = findings[1];
    expect(sqlInj.rule).toBe("sql-injection");
    expect(sqlInj.reference).toBe("https://owasp.org/sql-injection");

    // WARNING finding falls back to metadata.source
    const secrets = findings[2];
    expect(secrets.reference).toContain("semgrep.dev");
  });

  test("returns empty array for invalid JSON", () => {
    expect(parseSemgrepJson("not json")).toEqual([]);
  });

  test("returns empty array when no results key", () => {
    expect(parseSemgrepJson(JSON.stringify({ errors: [] }))).toEqual([]);
  });

  test("caps at 20 findings", () => {
    const manyResults = Array.from({ length: 30 }, (_, i) => ({
      check_id: `rule.r${i}`,
      path: `f${i}.ts`,
      start: { line: 1, col: 1 },
      end: { line: 1, col: 10 },
      extra: { message: `msg ${i}`, severity: "WARNING" },
    }));
    const json = JSON.stringify({ results: manyResults, errors: [] });
    expect(parseSemgrepJson(json)).toHaveLength(20);
  });
});

describe("parseGitleaksJson", () => {
  test("parses Gitleaks results", () => {
    const json = JSON.stringify([
      {
        Description: "Generic API Key",
        File: "src/config.ts",
        StartLine: 10,
        RuleID: "generic-api-key",
        Match: "AKIAIOSFODNN7EXAMPLE",
      },
      {
        Description: "Private Key",
        File: "keys/id_rsa",
        StartLine: 1,
        RuleID: "private-key",
      },
    ]);
    const findings = parseGitleaksJson(json);
    expect(findings).toHaveLength(2);
    expect(findings[0].rule).toBe("generic-api-key");
    expect(findings[0].file).toBe("src/config.ts:10");
    expect(findings[0].severity).toBe("ERROR");
    expect(findings[0].message).toBe("Generic API Key");
  });

  test("returns empty for invalid JSON", () => {
    expect(parseGitleaksJson("not json")).toEqual([]);
  });

  test("returns empty for non-array JSON", () => {
    expect(parseGitleaksJson(JSON.stringify({ results: [] }))).toEqual([]);
  });
});

describe("formatSecurityFindings", () => {
  test("zero findings from both tools shows green no-findings line", () => {
    const md = formatSecurityFindings([], 0, [], 0);
    expect(md).toBe("🟢 **No findings**");
  });

  test("Semgrep findings render a table with severity-sorted rows and references", () => {
    const findings = parseSemgrepJson(SAMPLE_JSON);
    const md = formatSecurityFindings(findings, 3, [], 0);
    expect(md).toContain("**SAST (Semgrep):**");
    expect(md).toContain("🔴 3 finding");
    expect(md).toContain("| `src/auth.ts:88` |");
    expect(md).toContain("[Link](https://owasp.org/sql-injection)");
    // Gitleaks section shows no findings
    expect(md).toContain("**Secret Detection (Gitleaks):** 🟢 No findings");
  });

  test("shows warning emoji when no ERROR-level findings", () => {
    const findings = [
      {
        rule: "r1",
        file: "a.ts:1",
        severity: "WARNING",
        message: "warn",
        reference: "",
      },
    ];
    const md = formatSecurityFindings(findings, 1, [], 0);
    expect(md).toContain("🟡 1 finding");
  });

  test("shows cap notice when totalCount exceeds displayed findings", () => {
    const findings = parseSemgrepJson(SAMPLE_JSON);
    const md = formatSecurityFindings(findings, 50, [], 0);
    expect(md).toContain("Showing 20 of 50 findings");
  });

  test("renders both Semgrep and Gitleaks findings when present", () => {
    const semgrep = parseSemgrepJson(SAMPLE_JSON);
    const gitleaks = parseGitleaksJson(
      JSON.stringify([
        {
          Description: "AWS Key",
          File: "env.ts",
          StartLine: 5,
          RuleID: "aws-access-key-id",
        },
      ]),
    );
    const md = formatSecurityFindings(semgrep, 3, gitleaks, 1);
    expect(md).toContain("**SAST (Semgrep):**");
    expect(md).toContain("**Secret Detection (Gitleaks):**");
    expect(md).toContain("| `env.ts:5` | aws-access-key-id |");
  });
});
