/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * The JSON below is verbatim pip-audit 2.10.1 output, captured rather than
 * written from the documentation.
 */

import { describe, expect, test } from "bun:test";
import { formatAuditFindings, parsePipAudit } from "../src/findings-audit";

const VULNERABLE = JSON.stringify({
  dependencies: [
    {
      name: "urllib3",
      version: "1.24.1",
      vulns: [
        {
          id: "PYSEC-2019-133",
          fix_versions: ["1.24.2"],
          aliases: ["CVE-2019-11324", "GHSA-mh33-7rrq-662w"],
          description:
            "The urllib3 library before 1.24.2 for Python mishandles certain cases where the desired set of CA certificates is different from the OS store of CA certificates, which results in SSL connections succeeding in situations where a verification failure is the correct outcome. This is related to use of the ssl_context, ca_certs, or ca_certs_dir argument.",
        },
        {
          id: "PYSEC-2019-132",
          fix_versions: ["1.24.3"],
          aliases: ["GHSA-r64q-w8jr-g9qp", "CVE-2019-11236"],
          description:
            "In the urllib3 library through 1.24.1 for Python, CRLF injection is possible if the attacker controls the request parameter.",
        },
      ],
    },
  ],
  fixes: [],
});

const CLEAN = JSON.stringify({
  dependencies: [{ name: "certifi", version: "2026.1.4", vulns: [] }],
  fixes: [],
});

describe("parsePipAudit", () => {
  test("reads advisories from the wrapped output shape", () => {
    const outcome = parsePipAudit(VULNERABLE);
    expect(outcome.status).toBe("vulnerable");
    if (outcome.status !== "vulnerable") return;
    expect(outcome.total).toBe(2);
    expect(outcome.packagesScanned).toBe(1);
    expect(outcome.advisories[0].package).toBe("urllib3");
    expect(outcome.advisories[0].version).toBe("1.24.1");
  });

  test("reads the bare array shape older releases print", () => {
    const bare = JSON.stringify([
      {
        name: "jinja2",
        version: "2.11.2",
        vulns: [{ id: "PYSEC-2021-66", fix_versions: ["2.11.3"], aliases: [] }],
      },
    ]);
    const outcome = parsePipAudit(bare);
    expect(outcome.status).toBe("vulnerable");
    if (outcome.status !== "vulnerable") return;
    expect(outcome.advisories[0].id).toBe("PYSEC-2021-66");
  });

  test("takes the first fix version", () => {
    const outcome = parsePipAudit(VULNERABLE);
    if (outcome.status !== "vulnerable") throw new Error("expected vulnerable");
    expect(outcome.advisories[0].fixVersion).toBe("1.24.3");
  });

  test("builds an advisory link from the GHSA alias", () => {
    const outcome = parsePipAudit(VULNERABLE);
    if (outcome.status !== "vulnerable") throw new Error("expected vulnerable");
    const byId = Object.fromEntries(
      outcome.advisories.map((a) => [a.id, a.url]),
    );
    expect(byId["PYSEC-2019-133"]).toBe(
      "https://github.com/advisories/GHSA-mh33-7rrq-662w",
    );
  });

  test("truncates a long description", () => {
    const outcome = parsePipAudit(VULNERABLE);
    if (outcome.status !== "vulnerable") throw new Error("expected vulnerable");
    const long = outcome.advisories.find((a) => a.id === "PYSEC-2019-133");
    expect(long?.description.length).toBeLessThanOrEqual(140);
    expect(long?.description.endsWith("…")).toBe(true);
  });

  test("sorts by package then advisory id", () => {
    const outcome = parsePipAudit(VULNERABLE);
    if (outcome.status !== "vulnerable") throw new Error("expected vulnerable");
    expect(outcome.advisories.map((a) => a.id)).toEqual([
      "PYSEC-2019-132",
      "PYSEC-2019-133",
    ]);
  });

  test("deduplicates a repeated package/advisory pair", () => {
    const dupe = JSON.stringify({
      dependencies: [
        {
          name: "urllib3",
          version: "1.24.1",
          vulns: [{ id: "PYSEC-1", aliases: [] }, { id: "PYSEC-1", aliases: [] }],
        },
      ],
    });
    const outcome = parsePipAudit(dupe);
    if (outcome.status !== "vulnerable") throw new Error("expected vulnerable");
    expect(outcome.total).toBe(1);
  });

  test("reports a scan with no findings as clean", () => {
    const outcome = parsePipAudit(CLEAN);
    expect(outcome.status).toBe("clean");
    if (outcome.status !== "clean") return;
    expect(outcome.packagesScanned).toBe(1);
  });

  test("skips a vulnerability record with no id", () => {
    const noId = JSON.stringify({
      dependencies: [{ name: "x", version: "1", vulns: [{ description: "?" }] }],
    });
    expect(parsePipAudit(noId).status).toBe("clean");
  });
});

describe("parsePipAudit — indeterminate", () => {
  test("invalid JSON does not read as clean", () => {
    const outcome = parsePipAudit("pip-audit: command not found");
    expect(outcome.status).toBe("indeterminate");
  });

  test("JSON without a dependency list does not read as clean", () => {
    const outcome = parsePipAudit('{"error": "resolution failed"}');
    expect(outcome.status).toBe("indeterminate");
  });

  test("empty output does not read as clean", () => {
    expect(parsePipAudit("").status).toBe("indeterminate");
  });
});

describe("formatAuditFindings", () => {
  test("a clean audit is green and counts what it scanned", () => {
    const md = formatAuditFindings(parsePipAudit(CLEAN));
    expect(md).toContain("🟢");
    expect(md).toContain("1 package");
  });

  test("advisories render as a table with the fix version", () => {
    const md = formatAuditFindings(parsePipAudit(VULNERABLE));
    expect(md).toContain("🔴");
    expect(md).toContain("2 advisories");
    expect(md).toContain("| Package | Installed | Advisory | Fixed in |");
    expect(md).toContain("`urllib3`");
    expect(md).toContain("`1.24.3`");
  });

  test("an advisory with no published fix says so", () => {
    const json = JSON.stringify({
      dependencies: [
        { name: "x", version: "1.0", vulns: [{ id: "PYSEC-9", aliases: [] }] },
      ],
    });
    expect(formatAuditFindings(parsePipAudit(json))).toContain("none published");
  });

  test("an indeterminate audit is not rendered as a pass", () => {
    const md = formatAuditFindings({
      status: "indeterminate",
      reason: "pip-audit is not installed",
    });
    expect(md).toContain("⚪");
    expect(md).toContain("did not complete");
    expect(md).toContain("This is not a pass");
    expect(md).not.toContain("🟢");
  });

  test("never returns an empty string", () => {
    for (const outcome of [
      parsePipAudit(CLEAN),
      parsePipAudit(VULNERABLE),
      parsePipAudit("junk"),
    ] as const) {
      expect(formatAuditFindings(outcome).length).toBeGreaterThan(0);
    }
  });
});
