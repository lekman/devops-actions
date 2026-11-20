/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Findings producer for the `audit` jobs. Parses the JSON of three
 * dependency auditors into one markdown summary for embedding inside the
 * Security Gate <details> body:
 *
 *   pip-audit      Python (python-audit)
 *   osv-scanner    Gradle lockfiles and Maven poms (jvm-audit)
 *   dotnet         `dotnet package list --vulnerable` (dotnet-audit)
 *
 * Three outcomes, kept distinct on purpose:
 *
 *   clean          the tool ran and found nothing
 *   vulnerable     the tool ran and found advisories
 *   indeterminate  the tool did not run, or its output could not be read
 *
 * The third is why this module exists rather than reusing a boolean. A zero
 * vulnerability count from a tool that never ran looks exactly like a clean
 * audit, and it is the shape a false green takes.
 *
 * pip-audit reports no severity — verified against 2.10.1, whose vuln
 * records carry only `id`, `fix_versions`, `aliases` and `description`. No
 * severity is invented here; the advisory id and the fixed version are what
 * the tool actually knows. OSV-Scanner reports a CVSS score per advisory
 * group and the .NET SDK a severity word, and those are shown when present.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ---- Types ----

export interface Advisory {
  /** Distribution name, e.g. "urllib3". */
  package: string;
  /** Installed version the advisory applies to. */
  version: string;
  /** Advisory identifier, e.g. "PYSEC-2019-133". */
  id: string;
  /** First version carrying the fix, when the advisory names one. */
  fixVersion?: string;
  /**
   * False when the tool does not report fixed versions at all, as the .NET
   * SDK's audit does not, so an empty `fixVersion` says nothing about
   * whether a fix exists.
   */
  fixReported?: boolean;
  /** Advisory summary, truncated for the table. */
  description: string;
  /** GitHub advisory link, when an alias supplies one. */
  url?: string;
}

export type AuditOutcome =
  | { status: "clean"; packagesScanned: number }
  | {
      status: "vulnerable";
      packagesScanned: number;
      advisories: Advisory[];
      total: number;
    }
  | { status: "indeterminate"; reason: string };

const MAX_ADVISORIES = 20;
const MAX_DESCRIPTION = 140;

// ---- Parser ----

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

/**
 * Read pip-audit's dependency list from either output shape.
 *
 * 2.10.x wraps it as `{"dependencies": [...], "fixes": [...]}`. Older 2.x
 * releases print a bare array. Accepting both means a tool upgrade does not
 * turn the audit indeterminate.
 */
function readDependencies(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  const wrapped = asRecord(parsed)?.dependencies;
  return Array.isArray(wrapped) ? wrapped : null;
}

/**
 * Turn one vulnerability record into an Advisory, or null when it carries
 * no identifier to report.
 */
function toAdvisory(
  pkg: string,
  version: string,
  vuln: unknown,
): Advisory | null {
  const record = asRecord(vuln);
  if (!record) return null;

  const id = asString(record.id);
  if (!id) return null;

  const description = asString(record.description) ?? id;
  const aliases = asStringArray(record.aliases);
  const ghsa = aliases.find((a) => a.startsWith("GHSA-"));

  return {
    package: pkg,
    version,
    id,
    fixVersion: asStringArray(record.fix_versions)[0],
    description:
      description.length > MAX_DESCRIPTION
        ? `${description.slice(0, MAX_DESCRIPTION - 1)}…`
        : description,
    url: ghsa ? `https://github.com/advisories/${ghsa}` : undefined,
  };
}

/**
 * Parse pip-audit JSON output.
 *
 * @param json Raw stdout from `pip-audit --format json`.
 * @returns The outcome, `indeterminate` when the output is not pip-audit's.
 */
export function parsePipAudit(json: string): AuditOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      status: "indeterminate",
      reason: "pip-audit output was not valid JSON",
    };
  }

  const dependencies = readDependencies(parsed);
  if (dependencies === null) {
    return {
      status: "indeterminate",
      reason: "pip-audit output carried no dependency list",
    };
  }

  const advisories: Advisory[] = [];
  const seen = new Set<string>();

  for (const dep of dependencies) {
    const record = asRecord(dep);
    if (!record) continue;
    const name = asString(record.name);
    if (!name) continue;
    const version = asString(record.version) ?? "";
    const vulns = Array.isArray(record.vulns) ? record.vulns : [];

    for (const vuln of vulns) {
      const advisory = toAdvisory(name, version, vuln);
      if (!advisory) continue;
      const key = `${advisory.package}:${advisory.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      advisories.push(advisory);
    }
  }

  if (advisories.length === 0) {
    return { status: "clean", packagesScanned: dependencies.length };
  }

  advisories.sort(
    (a, b) => a.package.localeCompare(b.package) || a.id.localeCompare(b.id),
  );

  return {
    status: "vulnerable",
    packagesScanned: dependencies.length,
    advisories: advisories.slice(0, MAX_ADVISORIES),
    total: advisories.length,
  };
}

// ---- OSV-Scanner ----

/**
 * Compare two version strings by their numeric parts, which is enough to
 * pick the nearest fixed version for Maven-style versions. Qualifiers such
 * as `-rc1` sort before the release they precede.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    v.split(/[.\-+_]/).map((p) => (/^\d+$/.test(p) ? Number(p) : -1));
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * The lowest `fixed` event above the installed version, across every range
 * the advisory lists for the package. An advisory can list several branches
 * (2.12.x fixed in 2.12.7.1, 2.13.x fixed in 2.13.4.2), and the nearest one
 * above the installed version is the upgrade to suggest.
 */
function osvFixedVersion(
  vuln: Record<string, unknown>,
  pkgName: string,
  installed: string,
): string | undefined {
  const fixes: string[] = [];
  const affected = Array.isArray(vuln.affected) ? vuln.affected : [];
  for (const entry of affected) {
    const record = asRecord(entry);
    const name = asString(asRecord(record?.package)?.name);
    if (name !== undefined && name !== pkgName) continue;
    const ranges = Array.isArray(record?.ranges) ? record.ranges : [];
    for (const range of ranges) {
      const events = asRecord(range)?.events;
      for (const event of Array.isArray(events) ? events : []) {
        const fixed = asString(asRecord(event)?.fixed);
        if (fixed) fixes.push(fixed);
      }
    }
  }
  return fixes
    .filter((f) => compareVersions(f, installed) > 0)
    .sort(compareVersions)[0];
}

/**
 * Parse `osv-scanner scan source --all-packages --format json` output.
 *
 * Verified against OSV-Scanner 2.7.1. Each scanned file is a `results`
 * entry with its `packages`; `--all-packages` lists every package, not only
 * the vulnerable ones, so the count of scanned packages is real. A package
 * with advisories carries `groups`, one per advisory once aliases are
 * merged, each with a `max_severity` CVSS score, and the `vulnerabilities`
 * records with the summary and the fixed versions.
 *
 * @param json Raw stdout from OSV-Scanner.
 */
export function parseOsvScanner(json: string): AuditOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      status: "indeterminate",
      reason: "osv-scanner output was not valid JSON",
    };
  }
  const results = asRecord(parsed)?.results;
  if (!Array.isArray(results)) {
    return {
      status: "indeterminate",
      reason: "osv-scanner output carried no results list",
    };
  }

  const scanned = new Set<string>();
  const advisories: Advisory[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    const packages = asRecord(result)?.packages;
    for (const entry of Array.isArray(packages) ? packages : []) {
      const record = asRecord(entry);
      const pkg = asRecord(record?.package);
      const name = asString(pkg?.name);
      if (!record || !name) continue;
      const version = asString(pkg?.version) ?? "";
      scanned.add(`${asString(pkg?.ecosystem) ?? ""}:${name}@${version}`);

      const vulns = (
        Array.isArray(record.vulnerabilities) ? record.vulnerabilities : []
      )
        .map(asRecord)
        .filter((v): v is Record<string, unknown> => v !== null);
      const groups = Array.isArray(record.groups) ? record.groups : [];

      for (const group of groups) {
        const g = asRecord(group);
        const ids = asStringArray(g?.ids);
        const aliases = asStringArray(g?.aliases);
        const id = ids.find((i) => i.startsWith("GHSA-")) ?? ids[0];
        if (!id) continue;
        const key = `${name}@${version}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const vuln =
          vulns.find((v) => ids.includes(asString(v.id) ?? "")) ?? {};
        const severity = asString(g?.max_severity);
        const summary = asString(vuln.summary) ?? asString(vuln.details) ?? id;
        const described = severity ? `CVSS ${severity} · ${summary}` : summary;
        const ghsa = [id, ...aliases].find((a) => a.startsWith("GHSA-"));

        advisories.push({
          package: name,
          version,
          id,
          fixVersion: osvFixedVersion(vuln, name, version),
          description: truncate(described),
          url: ghsa ? `https://github.com/advisories/${ghsa}` : undefined,
        });
      }
    }
  }

  if (scanned.size === 0) {
    return {
      status: "indeterminate",
      reason: "osv-scanner found no packages to check",
    };
  }
  return toOutcome(advisories, scanned.size);
}

// ---- dotnet package list ----

interface DotnetPackage {
  id: string;
  version: string;
  vulnerabilities: Array<{ severity: string; url: string }>;
}

/**
 * Walk `dotnet package list --format json` output into one entry per
 * package, version and project framework. Returns an error message
 * instead when the SDK reported a problem, such as a project that was not
 * restored.
 */
function readDotnetPackages(json: string): DotnetPackage[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return "dotnet package list output was not valid JSON";
  }
  const doc = asRecord(parsed);
  const projects = doc?.projects;
  if (!Array.isArray(projects)) {
    return "dotnet package list output carried no projects";
  }

  const problems = Array.isArray(doc?.problems) ? doc.problems : [];
  const error = problems
    .map(asRecord)
    .find((p) => asString(p?.level)?.toLowerCase() === "error");
  if (error) {
    return `dotnet package list reported: ${asString(error.text) ?? "an error"}`;
  }

  const out: DotnetPackage[] = [];
  for (const project of projects) {
    const frameworks = asRecord(project)?.frameworks;
    for (const framework of Array.isArray(frameworks) ? frameworks : []) {
      const f = asRecord(framework);
      for (const key of ["topLevelPackages", "transitivePackages"]) {
        const list = f?.[key];
        for (const entry of Array.isArray(list) ? list : []) {
          const p = asRecord(entry);
          const id = asString(p?.id);
          if (!id) continue;
          const vulns = Array.isArray(p?.vulnerabilities)
            ? p.vulnerabilities
            : [];
          out.push({
            id,
            version: asString(p?.resolvedVersion) ?? "",
            vulnerabilities: vulns
              .map(asRecord)
              .filter((v): v is Record<string, unknown> => v !== null)
              .map((v) => ({
                severity: asString(v.severity) ?? "",
                url: asString(v.advisoryurl) ?? "",
              })),
          });
        }
      }
    }
  }
  return out;
}

/**
 * Parse the .NET SDK's package audit.
 *
 * Verified against SDK 11.0.100. `dotnet package list --vulnerable
 * --include-transitive --format json` lists only vulnerable packages, each
 * with a severity word and an advisory URL and no fixed version. The count
 * of scanned packages comes from a second listing without `--vulnerable`,
 * when the caller has one.
 *
 * @param vulnerableJson Output of the `--vulnerable` listing.
 * @param allJson Output of the same listing without `--vulnerable`, or
 *   undefined when it is not available.
 */
export function parseDotnetPackageList(
  vulnerableJson: string,
  allJson?: string,
): AuditOutcome {
  const vulnerable = readDotnetPackages(vulnerableJson);
  if (typeof vulnerable === "string") {
    return { status: "indeterminate", reason: vulnerable };
  }

  let scanned = new Set(vulnerable.map((p) => `${p.id}@${p.version}`)).size;
  if (allJson !== undefined) {
    const all = readDotnetPackages(allJson);
    if (typeof all === "string") {
      return { status: "indeterminate", reason: all };
    }
    scanned = new Set(all.map((p) => `${p.id}@${p.version}`)).size;
  }

  const advisories: Advisory[] = [];
  const seen = new Set<string>();
  for (const pkg of vulnerable) {
    for (const vuln of pkg.vulnerabilities) {
      const id = vuln.url.match(/GHSA-[\w-]+/)?.[0] ?? vuln.url;
      if (!id) continue;
      const key = `${pkg.id}@${pkg.version}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      advisories.push({
        package: pkg.id,
        version: pkg.version,
        id,
        fixReported: false,
        description: vuln.severity ? `${vuln.severity} severity` : id,
        url: vuln.url.startsWith("https://") ? vuln.url : undefined,
      });
    }
  }
  return toOutcome(advisories, scanned);
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_DESCRIPTION
    ? `${flat.slice(0, MAX_DESCRIPTION - 1)}…`
    : flat;
}

/** Sort and cap advisories into an outcome. */
function toOutcome(
  advisories: Advisory[],
  packagesScanned: number,
): AuditOutcome {
  if (advisories.length === 0) return { status: "clean", packagesScanned };
  advisories.sort(
    (a, b) => a.package.localeCompare(b.package) || a.id.localeCompare(b.id),
  );
  return {
    status: "vulnerable",
    packagesScanned,
    advisories: advisories.slice(0, MAX_ADVISORIES),
    total: advisories.length,
  };
}

// ---- Formatting ----

/**
 * Render an audit outcome as markdown for the gate comment.
 *
 * @param outcome Parsed audit result.
 * @returns Markdown, never empty — an audit that did not run still reports.
 */
export function formatAuditFindings(outcome: AuditOutcome): string {
  if (outcome.status === "indeterminate") {
    return [
      `⚪ **Audit did not complete** — ${outcome.reason}.`,
      "",
      "This is not a pass. Dependencies were not checked against any advisory database on this run.",
    ].join("\n");
  }

  if (outcome.status === "clean") {
    const n = outcome.packagesScanned;
    return `🟢 **No known vulnerabilities** in ${n} package${n === 1 ? "" : "s"}`;
  }

  const { advisories, total, packagesScanned } = outcome;
  const header = `🔴 **${total} advisor${total === 1 ? "y" : "ies"}** across ${packagesScanned} package${packagesScanned === 1 ? "" : "s"}`;

  const rows = advisories.map((a) => {
    const id = a.url ? `[${a.id}](${a.url})` : a.id;
    const fix = a.fixVersion
      ? `\`${a.fixVersion}\``
      : a.fixReported === false
        ? "not reported"
        : "none published";
    return `| \`${a.package}\` | \`${a.version}\` | ${id} | ${fix} | ${a.description} |`;
  });

  const table = [
    "| Package | Installed | Advisory | Fixed in | Summary |",
    "|---------|-----------|----------|----------|---------|",
    ...rows,
  ].join("\n");

  const capped =
    total > MAX_ADVISORIES
      ? `\n\n_Showing ${MAX_ADVISORIES} of ${total} advisories._`
      : "";

  return `${header}\n\n${table}${capped}`;
}

// ---- CLI ----

export type AuditFormat = "pip-audit" | "osv-scanner" | "dotnet";

const TOOL_NAMES: Record<AuditFormat, string> = {
  "pip-audit": "pip-audit",
  "osv-scanner": "osv-scanner",
  dotnet: "dotnet package list",
};

/**
 * Read an auditor's result file into an outcome. A missing or unreadable
 * file is indeterminate, never clean.
 *
 * @param format Which auditor wrote the file.
 * @param jsonPath Path to its JSON output.
 * @param allJsonPath dotnet only: the listing without `--vulnerable`.
 */
export function readAuditResult(
  format: AuditFormat,
  jsonPath: string | undefined,
  allJsonPath?: string,
): AuditOutcome {
  const tool = TOOL_NAMES[format];
  if (!jsonPath || !existsSync(jsonPath)) {
    return { status: "indeterminate", reason: `${tool} wrote no result file` };
  }
  try {
    const json = readFileSync(jsonPath, "utf8");
    if (format === "osv-scanner") return parseOsvScanner(json);
    if (format === "dotnet") {
      const all =
        allJsonPath && existsSync(allJsonPath)
          ? readFileSync(allJsonPath, "utf8")
          : undefined;
      return parseDotnetPackageList(json, all);
    }
    return parsePipAudit(json);
  } catch {
    return {
      status: "indeterminate",
      reason: `${tool} result file could not be read`,
    };
  }
}

/* eslint-disable no-console -- CLI entrypoint, console output is intentional */
function main(): void {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--/, "");
    const value = process.argv[i + 1];
    if (key && value !== undefined) args.set(key, value);
  }

  const out = args.get("out");
  if (!out) {
    console.error("findings-audit: --out is required");
    process.exit(1);
  }

  const formatArg = args.get("format") ?? "pip-audit";
  if (!(formatArg in TOOL_NAMES)) {
    console.error(
      `findings-audit: --format must be pip-audit, osv-scanner or dotnet, got '${formatArg}'`,
    );
    process.exit(1);
  }
  const format = formatArg as AuditFormat;

  // The caller passes --reason when it already knows the audit could not
  // run — the tool missing, or a dependency export that failed. That is
  // reported as indeterminate without pretending to read a result file.
  const reason = args.get("reason");
  const outcome: AuditOutcome = reason
    ? { status: "indeterminate", reason }
    : readAuditResult(format, args.get("json"), args.get("all-json"));

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${formatAuditFindings(outcome)}\n`);
  console.log(`findings-audit: ${outcome.status} → ${out}`);
}

if (import.meta.main) {
  main();
}
/* eslint-enable no-console */
