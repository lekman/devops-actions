/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  formatAuditFindings,
  parseCargoAudit,
  readAuditResult,
} from "../src/findings-audit";

/** A report in the shape cargo-audit 0.23.0 writes with --json. */
function report(list: unknown[], dependencyCount = 42): string {
  return JSON.stringify({
    database: {
      "advisory-count": 900,
      "last-commit": "0123abc",
      "last-updated": "2026-11-27T10:00:00Z",
    },
    lockfile: { "dependency-count": dependencyCount },
    settings: { target_arch: [], target_os: [], severity: null, ignore: [] },
    vulnerabilities: { found: list.length > 0, count: list.length, list },
    warnings: {
      unmaintained: [
        {
          kind: "unmaintained",
          package: { name: "atty", version: "0.2.14" },
          advisory: { id: "RUSTSEC-2024-0375" },
        },
      ],
    },
  });
}

function vulnerability(
  id: string,
  name: string,
  version: string,
  patched: string[],
  extra: Record<string, unknown> = {},
): unknown {
  return {
    advisory: {
      id,
      package: name,
      title: `Problem in ${name}`,
      description: "Long description that the table does not show.",
      date: "2026-01-01",
      aliases: ["CVE-2026-0001"],
      cvss: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
      ...extra,
    },
    versions: { patched, unaffected: [] },
    affected: null,
    package: {
      name,
      version,
      source: "registry+https://github.com/rust-lang/crates.io-index",
    },
  };
}

describe("parseCargoAudit", () => {
  test("a report with no vulnerabilities is clean", () => {
    expect(parseCargoAudit(report([]))).toEqual({
      status: "clean",
      packagesScanned: 42,
    });
  });

  test("warnings alone do not make a report vulnerable", () => {
    expect(parseCargoAudit(report([], 3)).status).toBe("clean");
  });

  test("lists each advisory with its fixed version and link", () => {
    const outcome = parseCargoAudit(
      report([
        vulnerability("RUSTSEC-2026-0002", "time", "0.1.45", [">=0.2.23"]),
        vulnerability(
          "RUSTSEC-2026-0001",
          "openssl",
          "0.10.50",
          [">= 0.10.70"],
          {
            url: "https://github.com/sfackler/rust-openssl/security/advisories/GHSA-x",
          },
        ),
      ]),
    );
    expect(outcome.status).toBe("vulnerable");
    if (outcome.status !== "vulnerable") return;
    expect(outcome.total).toBe(2);
    expect(outcome.packagesScanned).toBe(42);
    expect(outcome.advisories.map((a) => a.package)).toEqual([
      "openssl",
      "time",
    ]);
    expect(outcome.advisories[0]).toMatchObject({
      id: "RUSTSEC-2026-0001",
      version: "0.10.50",
      fixVersion: "0.10.70",
      description: "Problem in openssl",
      url: "https://github.com/sfackler/rust-openssl/security/advisories/GHSA-x",
    });
    expect(outcome.advisories[1]?.url).toBe(
      "https://rustsec.org/advisories/RUSTSEC-2026-0002",
    );
  });

  test("a range it cannot reduce to one version is kept as written", () => {
    const outcome = parseCargoAudit(
      report([
        vulnerability("RUSTSEC-2026-0003", "x", "1.0.0", ["^1.2.4", ">=2.0.1"]),
      ]),
    );
    if (outcome.status !== "vulnerable") throw new Error(outcome.status);
    expect(outcome.advisories[0]?.fixVersion).toBe("^1.2.4");
  });

  test("an advisory with no patched version has no fix", () => {
    const outcome = parseCargoAudit(
      report([vulnerability("RUSTSEC-2026-0004", "y", "0.1.0", [])]),
    );
    if (outcome.status !== "vulnerable") throw new Error(outcome.status);
    expect(outcome.advisories[0]?.fixVersion).toBeUndefined();
    expect(formatAuditFindings(outcome)).toContain("none published");
  });

  test("the same advisory on the same package counts once", () => {
    const v = vulnerability("RUSTSEC-2026-0005", "z", "1.0.0", [">=1.0.1"]);
    const outcome = parseCargoAudit(report([v, v]));
    if (outcome.status !== "vulnerable") throw new Error(outcome.status);
    expect(outcome.total).toBe(1);
  });

  test("invalid JSON is indeterminate", () => {
    expect(
      parseCargoAudit("error: couldn't fetch advisory database").status,
    ).toBe("indeterminate");
  });

  test("JSON that is not a cargo-audit report is indeterminate", () => {
    expect(parseCargoAudit(JSON.stringify({ results: [] }))).toEqual({
      status: "indeterminate",
      reason: "cargo-audit output carried no vulnerability list",
    });
  });

  test("an empty lockfile is indeterminate, not clean", () => {
    expect(parseCargoAudit(report([], 0)).status).toBe("indeterminate");
  });
});

describe("readAuditResult with cargo-audit", () => {
  let dir: string;

  beforeEach(() => {
    dir = resolve(
      tmpdir(),
      `cargo-audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("a missing result file is indeterminate", () => {
    expect(readAuditResult("cargo-audit", resolve(dir, "none.json"))).toEqual({
      status: "indeterminate",
      reason: "cargo-audit wrote no result file",
    });
  });

  test("reads the report from disk", () => {
    const path = resolve(dir, "cargo-audit.json");
    writeFileSync(path, report([]));
    expect(readAuditResult("cargo-audit", path).status).toBe("clean");
  });
});
