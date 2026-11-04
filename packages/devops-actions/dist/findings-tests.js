/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Findings producer for the `quality` job. Parses:
 *   - JUnit XML     -> test summary (pass/fail/error/skip) + failing tests
 *   - LCOV info     -> line coverage % (bun, jest, vitest, c8)
 *   - Cobertura XML -> line coverage % (pytest-cov, coverage.py)
 *   - Lint log      -> error table (ESLint, Biome, ruff, black, generic)
 *   - Typecheck log -> error table (tsc, mypy)
 *
 * Writes a compact markdown summary to `--out` for embedding inside the
 * quality-gate <details> body. Missing inputs degrade gracefully.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const MAX_FINDINGS = 20;
const COVERAGE_THRESHOLD = 80;
// ---- JUnit ----
function numericAttr(tag, name) {
    const m = tag.match(new RegExp(`\\b${name}="(\\d+)"`));
    return m ? Number(m[1]) : 0;
}
/**
 * Parse totals from JUnit XML.
 *
 * bun's reporter puts the totals on the root `<testsuites>` element.
 * pytest leaves that element bare — `<testsuites name="pytest tests">` —
 * and writes the counts on each `<testsuite>` instead, so reading only the
 * root reports zero tests for a run that had plenty. When the root carries
 * no `tests` attribute, sum the suites.
 */
export function parseJunit(xml) {
    const root = xml.match(/<testsuites\b[^>]*>/);
    if (!root)
        return null;
    if (/\btests="\d+"/.test(root[0])) {
        return {
            tests: numericAttr(root[0], "tests"),
            failures: numericAttr(root[0], "failures"),
            errors: numericAttr(root[0], "errors"),
            skipped: numericAttr(root[0], "skipped"),
        };
    }
    const total = { tests: 0, failures: 0, errors: 0, skipped: 0 };
    const suiteRe = /<testsuite\b[^>]*>/g;
    for (let m = suiteRe.exec(xml); m !== null; m = suiteRe.exec(xml)) {
        total.tests += numericAttr(m[0], "tests");
        total.failures += numericAttr(m[0], "failures");
        total.errors += numericAttr(m[0], "errors");
        total.skipped += numericAttr(m[0], "skipped");
    }
    return total;
}
/**
 * Walk `<testcase>` elements that hold a `<failure>` or `<error>` child.
 *
 * Passing tests are written self-closing (`<testcase ... />`) by pytest and
 * by bun, so a pattern that assumes every testcase has a closing tag runs
 * past the passing ones and pins the failure on the wrong test. Each
 * opening tag is therefore matched on its own and its body, if it has one,
 * is taken up to the next `</testcase>`.
 *
 * `<error>` counts alongside `<failure>` because a test that could not run
 * is not a test that passed.
 */
export function parseJunitFailures(xml) {
    const findings = [];
    const openRe = /<testcase\b([^>]*?)(\/)?>/g;
    for (let m = openRe.exec(xml); m !== null && findings.length < MAX_FINDINGS; m = openRe.exec(xml)) {
        if (m[2])
            continue; // Self-closing: the test passed.
        const bodyStart = m.index + m[0].length;
        const bodyEnd = xml.indexOf("</testcase>", bodyStart);
        const body = xml.slice(bodyStart, bodyEnd === -1 ? undefined : bodyEnd);
        if (!body.includes("<failure") && !body.includes("<error"))
            continue;
        const attrs = m[1];
        const name = attrs.match(/\bname="([^"]*)"/)?.[1] ?? "unknown";
        // pytest names the module in `classname` and emits no `file`, so it is
        // the only location available there.
        const file = attrs.match(/\bfile="([^"]*)"/)?.[1] ??
            attrs.match(/\bclassname="([^"]*)"/)?.[1] ??
            "";
        const line = attrs.match(/\bline="([^"]*)"/)?.[1];
        const loc = file ? (line ? `${file}:${line}` : file) : "";
        findings.push({ file: loc, message: name, level: "error" });
    }
    return findings;
}
/**
 * Parse LCOV info format. Sum `LF:` (lines found) and `LH:` (lines hit)
 * across every record in the file — one record per source file, delimited
 * by `end_of_record`.
 */
export function parseLcov(info) {
    let linesFound = 0;
    let linesHit = 0;
    let seenAny = false;
    for (const line of info.split("\n")) {
        if (line.startsWith("LF:")) {
            linesFound += Number(line.slice(3));
            seenAny = true;
        }
        else if (line.startsWith("LH:")) {
            linesHit += Number(line.slice(3));
        }
    }
    if (!seenAny)
        return null;
    return { linesFound, linesHit };
}
/**
 * Parse LCOV per-file. Returns files below COVERAGE_THRESHOLD, sorted
 * by coverage % ascending (worst first), capped at MAX_FINDINGS.
 */
export function parseLcovLowCoverage(info) {
    const files = [];
    let currentFile = "";
    let lf = 0;
    let lh = 0;
    for (const line of info.split("\n")) {
        if (line.startsWith("SF:")) {
            currentFile = line.slice(3);
            lf = 0;
            lh = 0;
        }
        else if (line.startsWith("LF:")) {
            lf = Number(line.slice(3));
        }
        else if (line.startsWith("LH:")) {
            lh = Number(line.slice(3));
        }
        else if (line === "end_of_record" && currentFile && lf > 0) {
            const pct = (lh / lf) * 100;
            if (pct < COVERAGE_THRESHOLD) {
                files.push({ file: currentFile, linesFound: lf, linesHit: lh, pct });
            }
            currentFile = "";
        }
    }
    files.sort((a, b) => a.pct - b.pct);
    return files.slice(0, MAX_FINDINGS);
}
// ---- Cobertura ----
/**
 * Parse a Cobertura XML report, the format pytest-cov and coverage.py
 * write. The root element carries `lines-valid` and `lines-covered`:
 *
 *   <coverage lines-valid="8" lines-covered="7" line-rate="0.875" ...>
 *
 * Verified against coverage.py 7.16.0. Writers that emit only `line-rate`
 * give a percentage with no denominator, so the `<line hits="...">`
 * elements are summed instead rather than inventing a total.
 */
export function parseCobertura(xml) {
    const root = xml.match(/<coverage\b[^>]*>/);
    if (!root)
        return null;
    if (/\blines-valid="\d+"/.test(root[0])) {
        return {
            linesFound: numericAttr(root[0], "lines-valid"),
            linesHit: numericAttr(root[0], "lines-covered"),
        };
    }
    let linesFound = 0;
    let linesHit = 0;
    const lineRe = /<line\b[^>]*\bhits="(\d+)"[^>]*\/?>/g;
    for (let m = lineRe.exec(xml); m !== null; m = lineRe.exec(xml)) {
        linesFound += 1;
        if (Number(m[1]) > 0)
            linesHit += 1;
    }
    if (linesFound === 0)
        return null;
    return { linesFound, linesHit };
}
/**
 * Parse Cobertura per-file coverage. Returns files below
 * COVERAGE_THRESHOLD, worst first, capped at MAX_FINDINGS.
 *
 * Per-class elements carry `line-rate` but no line counts, so the counts
 * come from the `<line hits="...">` children inside each `<class>`.
 */
export function parseCoberturaLowCoverage(xml) {
    const files = [];
    const classRe = /<class\b([^>]*)>([\s\S]*?)<\/class>/g;
    for (let m = classRe.exec(xml); m !== null; m = classRe.exec(xml)) {
        const file = m[1].match(/\bfilename="([^"]*)"/)?.[1];
        if (!file)
            continue;
        let linesFound = 0;
        let linesHit = 0;
        const lineRe = /<line\b[^>]*\bhits="(\d+)"[^>]*\/?>/g;
        for (let l = lineRe.exec(m[2]); l !== null; l = lineRe.exec(m[2])) {
            linesFound += 1;
            if (Number(l[1]) > 0)
                linesHit += 1;
        }
        if (linesFound === 0)
            continue;
        const pct = (linesHit / linesFound) * 100;
        if (pct < COVERAGE_THRESHOLD) {
            files.push({ file, linesFound, linesHit, pct });
        }
    }
    files.sort((a, b) => a.pct - b.pct);
    return files.slice(0, MAX_FINDINGS);
}
// ---- Lint log ----
/**
 * Parse lint output for error lines. Handles ESLint stylish, Biome, ruff,
 * black, and generic `file:line:col: error message` formats.
 *
 * The formats do not collide. The generic JS matcher requires a
 * .ts/.tsx/.js/.jsx extension, and the ruff matcher requires .py, so a
 * polyglot repo's merged log parses both halves correctly.
 */
export function parseLintLog(log) {
    const findings = [];
    const lines = log.split("\n");
    let currentFile = "";
    for (let i = 0; i < lines.length && findings.length < MAX_FINDINGS; i++) {
        const line = lines[i];
        // Every message capture below starts with \S. A run of whitespace
        // followed by a group that can also match whitespace gives the engine
        // two ways to split each space, which is quadratic on a line of
        // spaces (CodeQL js/polynomial-redos). The log is tool output, but
        // the parser should not be the slow part of a red run.
        // ruff: `src/app.py:12:5: F401 [*] `os` imported but unused`
        const ruff = line.match(/^(\S+\.py):(\d+):(\d+):\s+([A-Z]+\d+)\s+(?:\[\*\]\s+)?(\S.*)$/);
        if (ruff) {
            findings.push({
                file: `${ruff[1]}:${ruff[2]}:${ruff[3]}`,
                message: `${ruff[4]}: ${ruff[5].trim()}`,
                level: "error",
            });
            continue;
        }
        // black: `would reformat src/app.py`
        const black = line.match(/^would reformat (\S+\.py)$/);
        if (black) {
            findings.push({
                file: black[1],
                message: "would be reformatted by black",
                level: "error",
            });
            continue;
        }
        // Biome header: `path/file.ts format/lint ━━━`
        const biomeHeader = line.match(/^(\S+\.(?:ts|tsx|js|jsx|json|css|md|yaml|yml))\s+(?:format|lint)\s*━/);
        if (biomeHeader) {
            currentFile = biomeHeader[1];
            for (let j = i + 1; j < lines.length && j < i + 5; j++) {
                const msg = lines[j].match(/^\s*×\s+(\S.*)/);
                if (msg) {
                    findings.push({
                        file: currentFile,
                        message: msg[1].trim(),
                        level: "error",
                    });
                    break;
                }
            }
            continue;
        }
        // ESLint file header: bare path line
        if (/^\/?\S+\.(?:ts|tsx|js|jsx|json)$/.test(line.trim())) {
            currentFile = line.trim();
            continue;
        }
        // ESLint stylish: `  12:5  error  message  rule-name`
        const eslint = line.match(/^\s+(\d+:\d+)\s+(error|warning)\s+(\S.*?)\s{2,}/);
        if (eslint && currentFile) {
            findings.push({
                file: `${currentFile}:${eslint[1]}`,
                message: eslint[3].trim(),
                level: eslint[2],
            });
            continue;
        }
        // Generic: `file.ts:12:5: error: message`
        const generic = line.match(/^(\S+\.(?:ts|tsx|js|jsx)[:(]\d+[,):]\d*):?\s*(error|warning):?\s*(\S.*)/i);
        if (generic) {
            findings.push({
                file: generic[1].replace(/[()]/g, ":").replace(/:$/, ""),
                message: generic[3].trim(),
                level: generic[2].toLowerCase(),
            });
        }
    }
    return findings;
}
// ---- Typecheck log ----
/**
 * Parse typechecker output. Two formats:
 *
 *   tsc   `src/file.ts(12,5): error TS1234: message`
 *   mypy  `src/app.py:12: error: message  [assignment]`
 *
 * mypy's `note:` lines are context for the error above them, not findings
 * of their own, so they are left out.
 */
export function parseTypecheckLog(log) {
    const findings = [];
    const tsc = /^(\S+\.tsx?)\((\d+),(\d+)\):\s*(error)\s+(TS\d+):\s*(\S.*)/gm;
    for (let m = tsc.exec(log); m !== null && findings.length < MAX_FINDINGS; m = tsc.exec(log)) {
        findings.push({
            file: `${m[1]}:${m[2]}:${m[3]}`,
            message: `${m[5]}: ${m[6]}`,
            level: "error",
        });
    }
    // Column is optional — mypy emits it only under --show-column-numbers.
    const mypy = /^(\S+\.py):(\d+)(?::(\d+))?:\s*(error|warning):\s*(\S.*)$/gm;
    for (let m = mypy.exec(log); m !== null && findings.length < MAX_FINDINGS; m = mypy.exec(log)) {
        const loc = m[3] ? `${m[1]}:${m[2]}:${m[3]}` : `${m[1]}:${m[2]}`;
        findings.push({
            file: loc,
            message: m[5].trim(),
            level: m[4],
        });
    }
    return findings;
}
// ---- Formatting ----
function findingsTable(label, items) {
    if (items.length === 0)
        return "";
    const rows = items.map((f) => `| \`${f.file}\` | ${f.message} |`);
    const capped = items.length >= MAX_FINDINGS
        ? `\n_Showing first ${MAX_FINDINGS} of potentially more findings._`
        : "";
    return `**${label}** (${items.length})\n\n| File | Message |\n|------|---------|${rows.length > 0 ? "\n" : ""}${rows.join("\n")}${capped}`;
}
export function formatFindings(tests, coverage, testFailures = [], lintFindings = [], typecheckFindings = [], lowCoverageFiles = []) {
    const sections = [];
    // Summary line (tests + coverage)
    const summaryParts = [];
    if (tests) {
        const bad = tests.failures + tests.errors;
        const passed = tests.tests - bad - tests.skipped;
        const total = tests.tests;
        const emoji = bad > 0 ? "🔴" : "🟢";
        let testLine = `${emoji} **${passed}/${total} tests passed**`;
        if (tests.failures > 0)
            testLine += ` · ${tests.failures} failed`;
        if (tests.errors > 0)
            testLine += ` · ${tests.errors} errored`;
        if (tests.skipped > 0)
            testLine += ` · ${tests.skipped} skipped`;
        summaryParts.push(testLine);
    }
    if (coverage && coverage.linesFound > 0) {
        const pct = (coverage.linesHit / coverage.linesFound) * 100;
        const emoji = pct >= 80 ? "🟢" : pct >= 60 ? "🟡" : "🔴";
        summaryParts.push(`${emoji} **${pct.toFixed(1)}% lines covered** (${coverage.linesHit}/${coverage.linesFound})`);
    }
    if (summaryParts.length > 0)
        sections.push(summaryParts.join(" · "));
    // Failure tables
    if (lintFindings.length > 0) {
        sections.push(findingsTable("Lint errors", lintFindings));
    }
    if (typecheckFindings.length > 0) {
        sections.push(findingsTable("Type errors", typecheckFindings));
    }
    if (testFailures.length > 0) {
        sections.push(findingsTable("Failing tests", testFailures));
    }
    // Low coverage files table
    if (lowCoverageFiles.length > 0) {
        const rows = lowCoverageFiles.map((f) => `| \`${f.file}\` | ${f.pct.toFixed(1)}% | ${f.linesHit}/${f.linesFound} |`);
        const capped = lowCoverageFiles.length >= MAX_FINDINGS
            ? `\n_Showing ${MAX_FINDINGS} lowest-coverage files._`
            : "";
        sections.push(`**Low coverage files** (<${COVERAGE_THRESHOLD}%)\n\n| File | Coverage | Lines |\n|------|----------|-------|\n${rows.join("\n")}${capped}`);
    }
    return sections.join("\n\n");
}
// ---- CLI ----
function readIfPresent(path) {
    if (!path || !existsSync(path))
        return null;
    try {
        return readFileSync(path, "utf8");
    }
    catch {
        return null;
    }
}
/* eslint-disable no-console -- CLI entrypoint, console output is intentional */
function main() {
    const args = new Map();
    for (let i = 2; i < process.argv.length; i += 2) {
        const key = process.argv[i]?.replace(/^--/, "");
        const value = process.argv[i + 1];
        if (key && value)
            args.set(key, value);
    }
    const junit = readIfPresent(args.get("junit"));
    const lcov = readIfPresent(args.get("lcov"));
    const coverageXml = readIfPresent(args.get("coverage-xml"));
    const lintLog = readIfPresent(args.get("lint-log"));
    const typecheckLog = readIfPresent(args.get("typecheck-log"));
    const out = args.get("out");
    const tests = junit ? parseJunit(junit) : null;
    const testFailures = junit ? parseJunitFailures(junit) : [];
    const lintFindings = lintLog ? parseLintLog(lintLog) : [];
    const typecheckFindings = typecheckLog ? parseTypecheckLog(typecheckLog) : [];
    // LCOV wins when a repo emits both, because it is what the node path has
    // always produced. A Python-only repo has no LCOV and falls through to
    // Cobertura.
    const coverage = lcov
        ? parseLcov(lcov)
        : coverageXml
            ? parseCobertura(coverageXml)
            : null;
    const lowCoverageFiles = lcov
        ? parseLcovLowCoverage(lcov)
        : coverageXml
            ? parseCoberturaLowCoverage(coverageXml)
            : [];
    const markdown = formatFindings(tests, coverage, testFailures, lintFindings, typecheckFindings, lowCoverageFiles);
    if (!markdown) {
        console.log("findings-tests: nothing to report; skipping write");
        return;
    }
    if (!out) {
        console.error("findings-tests: --out is required");
        process.exit(1);
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, markdown + "\n");
    console.log(`findings-tests: wrote ${out}`);
}
if (import.meta.main) {
    main();
}
/* eslint-enable no-console */
//# sourceMappingURL=findings-tests.js.map