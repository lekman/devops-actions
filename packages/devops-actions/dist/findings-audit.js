/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Findings producer for the `audit` job. Parses pip-audit JSON into a
 * markdown summary for embedding inside the Security Gate <details> body.
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
 * the tool actually knows.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const MAX_ADVISORIES = 20;
const MAX_DESCRIPTION = 140;
// ---- Parser ----
function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : null;
}
function asString(value) {
    return typeof value === "string" ? value : undefined;
}
function asStringArray(value) {
    return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}
/**
 * Read pip-audit's dependency list from either output shape.
 *
 * 2.10.x wraps it as `{"dependencies": [...], "fixes": [...]}`. Older 2.x
 * releases print a bare array. Accepting both means a tool upgrade does not
 * turn the audit indeterminate.
 */
function readDependencies(parsed) {
    if (Array.isArray(parsed))
        return parsed;
    const wrapped = asRecord(parsed)?.dependencies;
    return Array.isArray(wrapped) ? wrapped : null;
}
/**
 * Turn one vulnerability record into an Advisory, or null when it carries
 * no identifier to report.
 */
function toAdvisory(pkg, version, vuln) {
    const record = asRecord(vuln);
    if (!record)
        return null;
    const id = asString(record.id);
    if (!id)
        return null;
    const description = asString(record.description) ?? id;
    const aliases = asStringArray(record.aliases);
    const ghsa = aliases.find((a) => a.startsWith("GHSA-"));
    return {
        package: pkg,
        version,
        id,
        fixVersion: asStringArray(record.fix_versions)[0],
        description: description.length > MAX_DESCRIPTION
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
export function parsePipAudit(json) {
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
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
    const advisories = [];
    const seen = new Set();
    for (const dep of dependencies) {
        const record = asRecord(dep);
        if (!record)
            continue;
        const name = asString(record.name);
        if (!name)
            continue;
        const version = asString(record.version) ?? "";
        const vulns = Array.isArray(record.vulns) ? record.vulns : [];
        for (const vuln of vulns) {
            const advisory = toAdvisory(name, version, vuln);
            if (!advisory)
                continue;
            const key = `${advisory.package}:${advisory.id}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            advisories.push(advisory);
        }
    }
    if (advisories.length === 0) {
        return { status: "clean", packagesScanned: dependencies.length };
    }
    advisories.sort((a, b) => a.package.localeCompare(b.package) || a.id.localeCompare(b.id));
    return {
        status: "vulnerable",
        packagesScanned: dependencies.length,
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
export function formatAuditFindings(outcome) {
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
        const fix = a.fixVersion ? `\`${a.fixVersion}\`` : "none published";
        return `| \`${a.package}\` | \`${a.version}\` | ${id} | ${fix} | ${a.description} |`;
    });
    const table = [
        "| Package | Installed | Advisory | Fixed in | Summary |",
        "|---------|-----------|----------|----------|---------|",
        ...rows,
    ].join("\n");
    const capped = total > MAX_ADVISORIES
        ? `\n\n_Showing ${MAX_ADVISORIES} of ${total} advisories._`
        : "";
    return `${header}\n\n${table}${capped}`;
}
// ---- CLI ----
/* eslint-disable no-console -- CLI entrypoint, console output is intentional */
function main() {
    const args = new Map();
    for (let i = 2; i < process.argv.length; i += 2) {
        const key = process.argv[i]?.replace(/^--/, "");
        const value = process.argv[i + 1];
        if (key && value !== undefined)
            args.set(key, value);
    }
    const out = args.get("out");
    if (!out) {
        console.error("findings-audit: --out is required");
        process.exit(1);
    }
    // The caller passes --reason when it already knows the audit could not
    // run — pip-audit missing, or a dependency export that failed. That is
    // reported as indeterminate without pretending to read a result file.
    const reason = args.get("reason");
    const jsonPath = args.get("json");
    let outcome;
    if (reason) {
        outcome = { status: "indeterminate", reason };
    }
    else if (!jsonPath || !existsSync(jsonPath)) {
        outcome = {
            status: "indeterminate",
            reason: "pip-audit wrote no result file",
        };
    }
    else {
        try {
            outcome = parsePipAudit(readFileSync(jsonPath, "utf8"));
        }
        catch {
            outcome = {
                status: "indeterminate",
                reason: "pip-audit result file could not be read",
            };
        }
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${formatAuditFindings(outcome)}\n`);
    console.log(`findings-audit: ${outcome.status} → ${out}`);
}
if (import.meta.main) {
    main();
}
/* eslint-enable no-console */
//# sourceMappingURL=findings-audit.js.map