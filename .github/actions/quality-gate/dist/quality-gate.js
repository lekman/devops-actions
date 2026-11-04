/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// Replaced at build time by scripts/post-build.ts with the package version.
// Falls back to "dev" when running the TS source directly (tests, local).
const VERSION = "0.13.1".startsWith("__") ? "dev" : "0.13.1";
// ─── Knowledge base ─────────────────────────────────────────────────────
const KB_BASE_URL = "https://github.com/lekman/devops-actions/blob/main/docs/kb";
const JOB_KB_PAGE = {
    quality: "quality-gate.md",
    security: "security.md",
    audit: "security.md",
    "trunk-check": "trunk.md",
    "infra-preview": "infra.md",
    deliver: "quality-gate.md",
    deploy: "infra.md",
    verify: "quality-gate.md",
};
const JOB_RELATED_KB = {
    quality: [
        ["build.md", "Build"],
        ["typecheck.md", "Typecheck"],
        ["tests.md", "Tests"],
    ],
    security: [["secrets.md", "Secrets"]],
    audit: [["security.md", "Security"]],
    "trunk-check": [
        ["lint.md", "Lint"],
        ["trunk.md", "Trunk"],
    ],
};
export function kbUrlForJob(jobName) {
    const page = JOB_KB_PAGE[jobName] ?? "quality-gate.md";
    return `${KB_BASE_URL}/${page}`;
}
function kbLink(page, label) {
    return `[${label}](${KB_BASE_URL}/${page})`;
}
/**
 * Reads `<findingsDir>/<job>.md` if present and returns its trimmed content.
 * Returns an empty string when the dir is unset, the file is missing, or the
 * file is empty/whitespace-only. Producers (per-check jobs) write these as
 * workflow artifacts named "findings-<job>"; the caller workflow downloads
 * them with `merge-multiple: true` into one directory.
 */
function loadFindings(job, findingsDir) {
    if (!findingsDir)
        return "";
    try {
        const file = join(findingsDir, `${job}.md`);
        if (!existsSync(file))
            return "";
        return readFileSync(file, "utf8").trim();
    }
    catch {
        return "";
    }
}
function formatTimestamp(date) {
    const tz = process.env.QUALITY_GATE_TIMEZONE || "UTC";
    try {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        }).formatToParts(date);
        const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
        return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ${tz}`;
    }
    catch {
        // Invalid TZ falls back to ISO UTC
        return date.toISOString();
    }
}
function runUrl() {
    const server = process.env.GITHUB_SERVER_URL;
    const repo = process.env.GITHUB_REPOSITORY;
    const id = process.env.GITHUB_RUN_ID;
    if (!server || !repo || !id)
        return "";
    return `${server}/${repo}/actions/runs/${id}`;
}
/**
 * Fetches the jobs for the current workflow run and returns a map from
 * display name (and a few common variants) to the job's html_url. Used to
 * deep-link each check's "View run" to its specific job instead of the run
 * overview. Returns an empty map on any failure — the gate falls back to
 * the run URL silently.
 */
export async function fetchJobUrls(token) {
    const repo = process.env.GITHUB_REPOSITORY;
    const id = process.env.GITHUB_RUN_ID;
    if (!token || !repo || !id)
        return new Map();
    try {
        const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${id}/jobs?per_page=100`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
        });
        if (!res.ok)
            return new Map();
        const { jobs } = (await res.json());
        const map = new Map();
        for (const job of jobs) {
            map.set(job.name, job.html_url);
            // Reusable-workflow jobs are named "Caller / Job Name" — also index by
            // the suffix so JOB_LABEL matches even when CI is called from outside.
            const slash = job.name.lastIndexOf(" / ");
            if (slash !== -1) {
                map.set(job.name.slice(slash + 3), job.html_url);
            }
        }
        return map;
    }
    catch {
        return new Map();
    }
}
// ─── Job metadata ───────────────────────────────────────────────────────
const JOB_LABEL = {
    quality: "QA: Build, Typecheck, Test",
    security: "Security: SAST & Secret Detection",
    audit: "Security: Dependency Audit",
    "trunk-check": "QA: Linters, Static Code Analysis",
    "infra-preview": "IAC: Preview",
    deliver: "CI/CD: Continuous Delivery",
    deploy: "CI/CD: Continuous Deployment",
    verify: "QA: GAMP5 Verification",
};
const JOB_HINT = {
    quality: "Runs build, typecheck, and test:coverage via turbo (or plain bun). Expand the job log to see which task failed.",
    security: "Semgrep SAST (security-audit, secrets, typescript rulesets) and Gitleaks secret detection.",
    audit: "Dependency advisories from pip-audit. An audit that could not run reports as indeterminate, not as a pass.",
    "trunk-check": "Linters and static analysis (shellcheck, yamllint, markdownlint, actionlint, hadolint, checkov, osv-scanner, trufflehog, prettier).",
    "infra-preview": "Pulumi preview for infrastructure changes (Azure OIDC).",
    deliver: "Build, scan, and push container image to ACR.",
    deploy: "Deploy infrastructure and application via Pulumi up.",
    verify: "Post-deploy operational qualification tests (GAMP5 OQ).",
};
function resultEmoji(result) {
    switch (result) {
        case "success":
            return "🟢";
        case "failure":
            return "🔴";
        case "cancelled":
            return "🟡";
        case "skipped":
            return "⚪";
        case "pending":
            return "🔘";
        default:
            return "❔";
    }
}
export function evaluate(input) {
    const failures = [];
    const infraChanged = input.results["infra-changed"] === "true";
    for (const job of input.required) {
        const result = input.results[job];
        if (result !== "success") {
            failures.push(`${job}: ${result ?? "missing"}`);
        }
    }
    if (infraChanged && input.requiredWhenInfraChanged) {
        for (const job of input.requiredWhenInfraChanged) {
            const result = input.results[job];
            if (result !== "success" && result !== "skipped") {
                failures.push(`${job}: ${result ?? "missing"}`);
            }
        }
    }
    if (input.conditional) {
        for (const job of input.conditional) {
            const result = input.results[job];
            if (result !== "success" && result !== "skipped") {
                failures.push(`${job}: ${result ?? "missing"}`);
            }
        }
    }
    return { pass: failures.length === 0, failures };
}
function setOutput(name, value) {
    const outputFile = process.env.GITHUB_OUTPUT;
    if (outputFile) {
        appendFileSync(outputFile, `${name}=${value}\n`);
    }
}
export function formatSummary(input, result, mode = "final", options = {}) {
    const { jobUrls = new Map(), findingsDir = process.env.QUALITY_GATE_FINDINGS_DIR ?? "", dependabotBlock = "", supportUrl = "", } = options;
    const failedSet = new Set(result.failures.map((f) => f.split(":")[0].trim()));
    const requiredSet = new Set(input.required);
    const infraRequiredSet = new Set(input.requiredWhenInfraChanged ?? []);
    const run = runUrl();
    const now = formatTimestamp(new Date());
    // Collect all jobs in evaluation order, deduplicated
    const seen = new Set();
    const allJobs = [];
    for (const job of [
        ...input.required,
        ...(input.conditional ?? []),
        ...(input.requiredWhenInfraChanged ?? []),
    ]) {
        if (!seen.has(job)) {
            seen.add(job);
            allJobs.push(job);
        }
    }
    // Partition jobs into sections. Named `groups` come after "Quality Gate";
    // jobs not listed in any group fall into the default "Quality Gate" section.
    const namedGroups = input.groups ?? {};
    const groupedJobs = new Set();
    for (const jobs of Object.values(namedGroups)) {
        for (const job of jobs)
            groupedJobs.add(job);
    }
    const defaultJobs = allJobs.filter((j) => !groupedJobs.has(j));
    const sections = [
        { name: "Quality Gate", jobs: defaultJobs },
    ];
    for (const [name, jobs] of Object.entries(namedGroups)) {
        const presentJobs = jobs.filter((j) => allJobs.includes(j));
        if (presentJobs.length > 0) {
            sections.push({ name, jobs: presentJobs });
        }
    }
    const hasCancelled = Object.values(input.results).some((r) => r === "cancelled");
    // When the run was cancelled, keep every <details> collapsed — failures
    // from a half-finished run are not actionable.
    const isCancelledRun = mode === "final" && hasCancelled && !result.pass;
    const statusLineFor = (jobs) => {
        const sectionFails = jobs.filter((j) => failedSet.has(j));
        const sectionCancelled = jobs.some((j) => input.results[j] === "cancelled");
        let line;
        if (mode === "start") {
            line = `🔘 **IN PROGRESS**`;
        }
        else if (sectionCancelled && sectionFails.length > 0) {
            line = `🟡 **CANCELLED** — workflow cancelled before all checks finished`;
        }
        else if (sectionFails.length === 0) {
            line = `🟢 **PASSED**`;
        }
        else {
            const total = jobs.length;
            line = `🔴 **FAILED** — ${sectionFails.length} of ${total} check${total === 1 ? "" : "s"} failed`;
        }
        if (run)
            line += ` · [View workflow run](${run})`;
        return line;
    };
    const renderSection = (section) => {
        let section_md = `## ${section.name}\n\n${statusLineFor(section.jobs)}\n\n`;
        for (const job of section.jobs) {
            const jobResult = mode === "start" ? "pending" : (input.results[job] ?? "missing");
            const emoji = resultEmoji(jobResult);
            const label = JOB_LABEL[job] ?? job;
            const hint = JOB_HINT[job] ?? "";
            const required = requiredSet.has(job) || infraRequiredSet.has(job)
                ? "Required"
                : "Conditional";
            const isFailed = failedSet.has(job);
            const openAttr = isFailed && !isCancelledRun ? " open" : "";
            const jobUrl = jobUrls.get(label) ?? jobUrls.get(job) ?? run;
            const viewLink = jobUrl ? ` · <a href="${jobUrl}">View run</a>` : "";
            section_md += `<details${openAttr}>\n`;
            section_md += `<summary>${emoji} <b>${label}</b> — ${jobResult} · ${required}${viewLink}</summary>\n\n`;
            if (hint)
                section_md += `> ${hint}\n\n`;
            const findings = mode === "start" ? "" : loadFindings(job, findingsDir);
            if (findings)
                section_md += `${findings}\n\n`;
            const links = [kbLink(JOB_KB_PAGE[job] ?? "quality-gate.md", "KB")];
            const related = JOB_RELATED_KB[job];
            if (related && related.length > 0) {
                for (const [page, name] of related) {
                    links.push(kbLink(page, name));
                }
            }
            section_md += `**Troubleshooting:** ${links.join(" · ")}\n`;
            section_md += "\n</details>\n\n";
        }
        return section_md;
    };
    let md = "";
    for (const section of sections) {
        // No separator between sections — each H2 heading provides its own
        // border-bottom when rendered.
        md += renderSection(section);
    }
    // Dependabot alerts (informational, appended after the last gate section)
    if (dependabotBlock)
        md += dependabotBlock;
    // Support link — only shown when there are failures
    if (supportUrl && !result.pass && mode === "final") {
        md += `[Request Support](${supportUrl})\n\n`;
    }
    // Footer — empty "## " line renders as a thin H2 underline (subtle HR)
    const versionLabel = /^\d/.test(VERSION) ? `v${VERSION}` : VERSION;
    md += `## \n\n<sub>${versionLabel} · ${now}</sub>\n`;
    md += "<!-- quality-gate -->\n";
    return md;
}
/**
 * Fetch open high/critical Dependabot alerts. Returns a markdown block
 * for embedding after the Security Gate section. Informational only —
 * never affects gate pass/fail. Returns empty string on any failure.
 */
export async function fetchDependabotAlerts(token, repo) {
    if (!token || !repo)
        return "";
    try {
        const res = await fetch(`https://api.github.com/repos/${repo}/dependabot/alerts?state=open&severity=high,critical&per_page=25`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        });
        if (!res.ok)
            return "";
        const alerts = (await res.json());
        if (alerts.length === 0)
            return "";
        const rows = alerts.map((a) => `| ${a.security_vulnerability.package.name} | ${a.security_advisory.severity.toUpperCase()} | [Advisory](${a.html_url}) |`);
        return [
            `\n<details>`,
            `<summary>🟡 <b>Dependabot</b> — ${alerts.length} open alert${alerts.length === 1 ? "" : "s"} (high/critical)</summary>\n`,
            `> These are existing alerts on the default branch, not introduced by this PR.\n`,
            `| Dependency | Severity | Advisory |`,
            `|------------|----------|----------|`,
            ...rows,
            `\n[View all Dependabot alerts](https://github.com/${repo}/security/dependabot)\n`,
            `</details>\n`,
        ].join("\n");
    }
    catch {
        return "";
    }
}
// ─── PR comment ─────────────────────────────────────────────────────────
const API_BASE = "https://api.github.com";
async function findGateComment(owner, repo, prNumber, token) {
    const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
        },
    });
    if (!res.ok)
        return null;
    const comments = (await res.json());
    const existing = comments.find((c) => c.body?.includes("<!-- quality-gate -->"));
    return existing?.id ?? null;
}
async function postPrComment(markdown, token, repo, prNumber) {
    const [owner, repoName] = repo.split("/");
    const existingId = await findGateComment(owner, repoName, prNumber, token);
    if (existingId) {
        await fetch(`${API_BASE}/repos/${owner}/${repoName}/issues/comments/${existingId}`, {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
            body: JSON.stringify({ body: markdown }),
        });
    }
    else {
        await fetch(`${API_BASE}/repos/${owner}/${repoName}/issues/${prNumber}/comments`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
            body: JSON.stringify({ body: markdown }),
        });
    }
}
// ─── CLI entrypoint ─────────────────────────────────────────────────────
/* eslint-disable no-console -- CLI entrypoint, console output is intentional */
async function main() {
    const raw = process.argv[2];
    if (!raw) {
        console.error('Usage: node quality-gate.js \'{"required":[...],"results":{...}}\'');
        process.exit(1);
    }
    const mode = process.env.QUALITY_GATE_MODE === "start" ? "start" : "final";
    let input;
    try {
        const parsed = JSON.parse(raw);
        // Support both formats:
        //   1. Full: {"required":["quality","security"],"results":{...}}
        //   2. Flat: {"quality":"success","security":"failure",...}
        if (parsed.results && typeof parsed.results === "object") {
            input = parsed;
        }
        else {
            input = {
                required: ["quality", "security"],
                results: parsed,
            };
        }
    }
    catch {
        console.error("Argument is not valid JSON");
        process.exit(1);
    }
    const result = mode === "start" ? { pass: true, failures: [] } : evaluate(input);
    if (mode === "final") {
        setOutput("pass", String(result.pass));
        setOutput("failures", result.failures.join(","));
    }
    // Deep-link each check's "View run" to its specific job when possible
    const jobUrls = await fetchJobUrls(process.env.GITHUB_TOKEN);
    // Fetch Dependabot alerts (informational, final mode only)
    const dependabotBlock = mode === "final"
        ? await fetchDependabotAlerts(process.env.GITHUB_TOKEN, process.env.GITHUB_REPOSITORY)
        : "";
    const token = process.env.GITHUB_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY;
    const prNumber = process.env.PR_NUMBER;
    // Build support request URL (shown only on failure)
    let supportUrl = "";
    if (repository && prNumber) {
        const prUrl = `https://github.com/${repository}/pull/${prNumber}`;
        const title = encodeURIComponent(`[Support] PR #${prNumber}`);
        const body = encodeURIComponent(`## Related PR\n${prUrl}\n\n## Context\n\n## Observed behaviour\n\n## Expected behaviour\n`);
        supportUrl = `https://github.com/${repository}/issues/new?template=request-support.md&title=${title}&labels=devops%3Atriage&body=${body}`;
    }
    // Build and post summary
    const summary = formatSummary(input, result, mode, {
        jobUrls,
        dependabotBlock,
        supportUrl,
    });
    if (token && repository && prNumber) {
        try {
            await postPrComment(summary, token, repository, prNumber);
            console.log(`Posted quality gate comment on PR #${prNumber}`);
        }
        catch (err) {
            console.error("Could not post PR comment (non-fatal):", err);
        }
    }
    if (mode === "start") {
        console.log("Quality gate placeholder posted");
        return;
    }
    if (result.pass) {
        console.log("Quality gate passed");
    }
    else {
        console.error("Quality gate failed:");
        for (const f of result.failures) {
            const jobName = f.split(":")[0].trim();
            console.error(`  - ${f}`);
            console.error(`    → ${kbUrlForJob(jobName)}`);
        }
        process.exit(1);
    }
}
if (import.meta.main) {
    main().catch((err) => {
        console.error("Quality gate error:", err);
        process.exit(1);
    });
}
/* eslint-enable no-console */
//# sourceMappingURL=quality-gate.js.map