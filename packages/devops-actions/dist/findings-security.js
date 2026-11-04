/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Findings producer for the `security` job. Parses Semgrep JSON output
 * and writes a markdown summary with a findings table for embedding
 * inside the Security Gate <details> body.
 *
 * Severity sort: ERROR > WARNING > INFO.
 * Capped at 20 rows; links to the full SARIF artifact when available.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const MAX_FINDINGS = 20;
const SEVERITY_ORDER = {
    ERROR: 0,
    WARNING: 1,
    INFO: 2,
};
// ---- Parsers ----
/**
 * Parse Semgrep JSON output into a sorted, capped list of findings.
 */
export function parseSemgrepJson(json) {
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        return [];
    }
    if (!Array.isArray(parsed.results))
        return [];
    const findings = parsed.results.map((r) => {
        // Shorten rule ID: "p/typescript.some-rule" → "some-rule"
        const ruleShort = r.check_id.includes(".")
            ? r.check_id.split(".").slice(-1)[0]
            : r.check_id;
        // Extract reference URL from metadata (Semgrep rules often include references or source)
        const meta = r.extra.metadata ?? {};
        const refs = meta.references;
        const source = meta.source;
        const reference = refs?.[0] ?? source ?? "";
        return {
            rule: ruleShort,
            file: `${r.path}:${r.start.line}`,
            severity: r.extra.severity,
            message: r.extra.message.split("\n")[0].slice(0, 120),
            reference,
        };
    });
    // Sort by severity (ERROR first), then file path
    findings.sort((a, b) => {
        const sa = SEVERITY_ORDER[a.severity] ?? 3;
        const sb = SEVERITY_ORDER[b.severity] ?? 3;
        if (sa !== sb)
            return sa - sb;
        return a.file.localeCompare(b.file);
    });
    return findings.slice(0, MAX_FINDINGS);
}
/**
 * Parse Gitleaks JSON output into findings.
 */
export function parseGitleaksJson(json) {
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        return [];
    }
    if (!Array.isArray(parsed))
        return [];
    return parsed.slice(0, MAX_FINDINGS).map((r) => ({
        rule: r.RuleID,
        file: `${r.File}:${r.StartLine}`,
        severity: "ERROR",
        message: r.Description,
        reference: "",
    }));
}
// ---- Formatting ----
function renderFindingsTable(label, findings, totalCount, hasReference) {
    if (totalCount === 0)
        return `**${label}:** 🟢 No findings`;
    const emoji = findings.some((f) => f.severity === "ERROR") ? "🔴" : "🟡";
    const parts = [];
    parts.push(`**${label}:** ${emoji} ${totalCount} finding${totalCount === 1 ? "" : "s"}`);
    const refHeader = hasReference ? " | Reference" : "";
    const refSep = hasReference ? " |----------" : "";
    const rows = findings.map((f) => {
        const ref = hasReference
            ? ` | ${f.reference ? `[Link](${f.reference})` : ""}`
            : "";
        return `| \`${f.file}\` | ${f.rule} | ${f.severity} | ${f.message}${ref} |`;
    });
    let table = `| File | Rule | Severity | Message${refHeader} |\n|------|------|----------|--------${refSep} |`;
    if (rows.length > 0)
        table += `\n${rows.join("\n")}`;
    if (totalCount > MAX_FINDINGS) {
        table += `\n\n_Showing ${MAX_FINDINGS} of ${totalCount} findings._`;
    }
    parts.push(table);
    return parts.join("\n\n");
}
export function formatSecurityFindings(semgrepFindings, semgrepTotal, gitleaksFindings = [], gitleaksTotal = 0) {
    const allClear = semgrepTotal === 0 && gitleaksTotal === 0;
    if (allClear)
        return "🟢 **No findings**";
    const sections = [];
    sections.push(renderFindingsTable("SAST (Semgrep)", semgrepFindings, semgrepTotal, true));
    sections.push(renderFindingsTable("Secret Detection (Gitleaks)", gitleaksFindings, gitleaksTotal, false));
    return sections.join("\n\n");
}
// ---- CLI ----
/* eslint-disable no-console -- CLI entrypoint */
function main() {
    const args = new Map();
    for (let i = 2; i < process.argv.length; i += 2) {
        const key = process.argv[i]?.replace(/^--/, "");
        const value = process.argv[i + 1];
        if (key && value)
            args.set(key, value);
    }
    const semgrepPath = args.get("json");
    const gitleaksPath = args.get("gitleaks");
    const out = args.get("out");
    // Parse Semgrep
    let semgrepFindings = [];
    let semgrepTotal = 0;
    if (semgrepPath && existsSync(semgrepPath)) {
        try {
            const raw = readFileSync(semgrepPath, "utf8");
            const parsed = JSON.parse(raw);
            semgrepTotal = parsed.results?.length ?? 0;
            semgrepFindings = parseSemgrepJson(raw);
        }
        catch {
            console.log("findings-security: could not parse Semgrep JSON");
        }
    }
    // Parse Gitleaks
    let gitleaksFindings = [];
    let gitleaksTotal = 0;
    if (gitleaksPath && existsSync(gitleaksPath)) {
        try {
            const raw = readFileSync(gitleaksPath, "utf8");
            const parsed = JSON.parse(raw);
            gitleaksTotal = Array.isArray(parsed) ? parsed.length : 0;
            gitleaksFindings = parseGitleaksJson(raw);
        }
        catch {
            console.log("findings-security: could not parse Gitleaks JSON");
        }
    }
    if (semgrepTotal === 0 &&
        gitleaksTotal === 0 &&
        !semgrepPath &&
        !gitleaksPath) {
        console.log("findings-security: no inputs found; skipping");
        return;
    }
    const markdown = formatSecurityFindings(semgrepFindings, semgrepTotal, gitleaksFindings, gitleaksTotal);
    if (!out) {
        console.error("findings-security: --out is required");
        process.exit(1);
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, markdown + "\n");
    const total = semgrepTotal + gitleaksTotal;
    console.log(`findings-security: wrote ${out} (${total} findings)`);
}
if (import.meta.main) {
    main();
}
/* eslint-enable no-console */
//# sourceMappingURL=findings-security.js.map