/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Findings producer for the `quality` job. Parses:
 *   - JUnit XML     -> test summary (pass/fail/error/skip) + failing tests
 *   - LCOV info     -> line coverage % (bun, jest, vitest, c8)
 *   - Cobertura XML -> line coverage % (pytest-cov, coverage.py, coverlet,
 *                      Microsoft code coverage)
 *   - JaCoCo XML    -> line coverage % (JaCoCo, Kover)
 *   - Lint log      -> error table (ESLint, Biome, ruff, black, ktlint,
 *                      detekt, google-java-format, dotnet format, generic)
 *   - Typecheck log -> error table (tsc, mypy, kotlinc, javac, C# compiler)
 *
 * JUnit and coverage inputs each take one path or several, and a directory
 * stands for every report below it, because Gradle and Maven write one
 * JUnit file per test class and one coverage report per module.
 *
 * Writes a compact markdown summary to `--out` for embedding inside the
 * quality-gate <details> body. Missing inputs degrade gracefully.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { COVERAGE_THRESHOLD, combineCoverage, expandReportPaths, readAll, } from "./coverage.js";
export { parseCobertura, parseCoberturaLowCoverage, parseJacoco, parseJacocoLowCoverage, parseLcov, parseLcovLowCoverage, } from "./coverage.js";
const MAX_FINDINGS = 20;
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
 * no `tests` attribute, sum the suites. Gradle's and Maven Surefire's
 * per-class files have no `<testsuites>` root at all, only one
 * `<testsuite>`, which the same sum reads.
 */
export function parseJunit(xml) {
    const root = xml.match(/<testsuites\b[^>]*>/);
    if (root && /\btests="\d+"/.test(root[0])) {
        return {
            tests: numericAttr(root[0], "tests"),
            failures: numericAttr(root[0], "failures"),
            errors: numericAttr(root[0], "errors"),
            skipped: numericAttr(root[0], "skipped"),
        };
    }
    const total = { tests: 0, failures: 0, errors: 0, skipped: 0 };
    let suites = 0;
    const suiteRe = /<testsuite\b[^>]*>/g;
    for (let m = suiteRe.exec(xml); m !== null; m = suiteRe.exec(xml)) {
        suites += 1;
        total.tests += numericAttr(m[0], "tests");
        total.failures += numericAttr(m[0], "failures");
        total.errors += numericAttr(m[0], "errors");
        total.skipped += numericAttr(m[0], "skipped");
    }
    return root || suites > 0 ? total : null;
}
/**
 * Add up the totals of several JUnit files. Returns null when none of them
 * was JUnit XML.
 */
export function sumJunit(xmls) {
    let any = false;
    const total = { tests: 0, failures: 0, errors: 0, skipped: 0 };
    for (const xml of xmls) {
        const summary = parseJunit(xml);
        if (!summary)
            continue;
        any = true;
        total.tests += summary.tests;
        total.failures += summary.failures;
        total.errors += summary.errors;
        total.skipped += summary.skipped;
    }
    return any ? total : null;
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
// ---- Lint log ----
/**
 * Parse lint output for error lines. Handles ESLint stylish, Biome, ruff,
 * black, rustfmt, rustc and clippy, and generic `file:line:col: error
 * message` formats.
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
        // rustfmt --check: `Diff in /work/src/lib.rs:12:`, or the older
        // `Diff in /work/src/lib.rs at line 12:`.
        const rustfmt = line.match(/^Diff in (\S+\.rs)(?::(\d+):| at line (\d+):)/);
        if (rustfmt) {
            findings.push({
                file: `${rustfmt[1]}:${rustfmt[2] ?? rustfmt[3]}`,
                message: "would be reformatted by rustfmt",
                level: "error",
            });
            continue;
        }
        // rustc and clippy: a level line, then the location on the next line.
        //   error: unused variable: `x`
        //     --> src/lib.rs:3:9
        // Summary lines (`error: could not compile ...`) have no location line
        // and are skipped.
        const rustc = line.match(/^(error|warning)(?:\[[A-Za-z0-9_:]+\])?: (\S.*)$/);
        if (rustc) {
            const at = lines[i + 1]?.match(/^\s*--> (\S+\.rs):(\d+):(\d+)/);
            if (at) {
                findings.push({
                    file: `${at[1]}:${at[2]}:${at[3]}`,
                    message: rustc[2].trim(),
                    level: rustc[1],
                });
                i++;
                continue;
            }
        }
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
        // black: `would reformat src/app.py`. The jvm-quality action writes
        // the same line for each file google-java-format would change.
        const reformat = line.match(/^would reformat (\S+\.(py|java))$/);
        if (reformat) {
            const tool = reformat[2] === "py" ? "black" : "google-java-format";
            findings.push({
                file: reformat[1],
                message: `would be reformatted by ${tool}`,
                level: "error",
            });
            continue;
        }
        // ktlint plain reporter and detekt's console output:
        //   `src/App.kt:8:19: Missing spacing after ":" (standard:colon-spacing)`
        //   `/abs/src/App.kt:14:21: This expression contains a magic number. [MagicNumber]`
        const kotlin = line.match(/^(\S+\.kts?):(\d+):(\d+):\s+(\S.*)$/);
        if (kotlin) {
            findings.push({
                file: `${kotlin[1]}:${kotlin[2]}:${kotlin[3]}`,
                message: kotlin[4].trim(),
                level: "error",
            });
            continue;
        }
        // dotnet format and MSBuild:
        //   `/abs/src/App.cs(8,25): error WHITESPACE: Fix whitespace formatting. [/abs/App.csproj]`
        const msbuild = matchMsbuild(line);
        if (msbuild) {
            findings.push(msbuild);
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
    return dedupe(findings);
}
// ---- Typecheck log ----
/**
 * Parse typechecker and compiler output:
 *
 *   tsc      `src/file.ts(12,5): error TS1234: message`
 *   mypy     `src/app.py:12: error: message  [assignment]`
 *   kotlinc  see matchJvmCompiler
 *   javac    see matchJvmCompiler
 *   C#       see matchMsbuild
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
    for (const line of log.split("\n")) {
        if (findings.length >= MAX_FINDINGS)
            break;
        const jvm = matchJvmCompiler(line);
        if (jvm) {
            findings.push(jvm);
            continue;
        }
        const msbuild = matchMsbuild(line);
        if (msbuild)
            findings.push(msbuild);
    }
    return dedupe(findings);
}
/**
 * Match a Kotlin or Java compiler diagnostic, as Gradle or Maven prints it:
 *
 *   kotlinc (Gradle)  `e: file:///abs/App.kt:3:5 Unresolved reference 'x'.`
 *   kotlinc (Maven)   `[ERROR] file:///abs/App.kt:3:5 Unresolved reference 'x'.`
 *   javac (Gradle)    `/abs/App.java:3: error: cannot find symbol`
 *   javac (Maven)     `[ERROR] /abs/App.java:[3,5] cannot find symbol`
 *
 * Warnings are left out. The jvm-quality action does not turn them into
 * errors, so listing them under "Type errors" would misreport the build.
 */
export function matchJvmCompiler(line) {
    const kotlinc = line.match(/^(?:e:|\[ERROR\])\s+(?:file:\/\/)?(\S+\.kts?):(\d+):(\d+)\s+(\S.*)$/);
    if (kotlinc) {
        return {
            file: `${kotlinc[1]}:${kotlinc[2]}:${kotlinc[3]}`,
            message: kotlinc[4].trim(),
            level: "error",
        };
    }
    const javacGradle = line.match(/^(\S+\.java):(\d+):\s+error:\s+(\S.*)$/);
    if (javacGradle) {
        return {
            file: `${javacGradle[1]}:${javacGradle[2]}`,
            message: javacGradle[3].trim(),
            level: "error",
        };
    }
    const javacMaven = line.match(/^\[ERROR\]\s+(\S+\.java):\[(\d+),(\d+)\]\s+(\S.*)$/);
    if (javacMaven) {
        return {
            file: `${javacMaven[1]}:${javacMaven[2]}:${javacMaven[3]}`,
            message: javacMaven[4].trim(),
            level: "error",
        };
    }
    return null;
}
/**
 * Match an MSBuild diagnostic for a C#, F# or VB file, as the C# compiler,
 * analyzers and `dotnet format` print it:
 *
 *   `/abs/App.cs(8,25): error CS0103: The name 'x' does not exist [/abs/App.csproj]`
 *
 * The trailing project path is dropped. Only errors are kept: the
 * dotnet-quality build treats warnings as errors, so a warning that
 * matters arrives as an error.
 */
export function matchMsbuild(line) {
    const m = line.match(/^\s*(\S.*?\.(?:cs|fs|vb))\((\d+),(\d+)(?:,\d+,\d+)?\):\s+error\s+([A-Za-z]+\d*):\s+(\S.*?)(?:\s+\[[^\]]+\])?$/);
    if (!m)
        return null;
    return {
        file: `${m[1]}:${m[2]}:${m[3]}`,
        message: `${m[4]}: ${m[5].trim()}`,
        level: "error",
    };
}
/**
 * Drop repeated findings. MSBuild prints every error twice, once as it
 * happens and once in the summary at the end of the build.
 */
function dedupe(findings) {
    const seen = new Set();
    return findings.filter((f) => {
        const key = `${f.file}|${f.message}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
/**
 * Make a path from a log relative to the checkout, so the gate comment
 * shows `src/App.kt` rather than the runner's absolute path. Kotlin
 * compilers prefix paths with `file://`, which is removed too.
 *
 * @param file Path as the tool printed it, possibly with `:line:col`.
 * @param workspace Absolute checkout path, usually GITHUB_WORKSPACE.
 */
export function relativeToWorkspace(file, workspace) {
    let out = file.replace(/^file:\/\//, "");
    if (workspace) {
        const prefix = workspace.endsWith("/") ? workspace : `${workspace}/`;
        if (out.startsWith(prefix)) {
            out = out.slice(prefix.length);
        }
        else if (prefix.startsWith("/") && out.startsWith(prefix.slice(1))) {
            // coverlet writes source paths without their leading slash.
            out = out.slice(prefix.length - 1);
        }
    }
    return out;
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
/**
 * Read every report a path list names. Each argument may hold several
 * paths separated by newlines or commas, and a directory stands for every
 * matching file below it.
 */
function readReports(spec, extensions) {
    if (!spec)
        return [];
    return readAll(expandReportPaths(spec, extensions));
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
    const junits = readReports(args.get("junit"), [".xml"]);
    const lcovs = readReports(args.get("lcov"), [".info"]);
    const coberturas = readReports(args.get("coverage-xml"), [".xml"]);
    const jacocos = readReports(args.get("jacoco-xml"), [".xml"]);
    const lintLog = readIfPresent(args.get("lint-log"));
    const typecheckLog = readIfPresent(args.get("typecheck-log"));
    const out = args.get("out");
    const workspace = process.env.GITHUB_WORKSPACE ?? "";
    const tests = sumJunit(junits);
    const testFailures = junits
        .flatMap(parseJunitFailures)
        .slice(0, MAX_FINDINGS);
    const relative = (items) => items.map((f) => ({ ...f, file: relativeToWorkspace(f.file, workspace) }));
    const lintFindings = relative(lintLog ? parseLintLog(lintLog) : []);
    const typecheckFindings = relative(typecheckLog ? parseTypecheckLog(typecheckLog) : []);
    // One source of coverage, in this order. LCOV wins when a repo emits
    // several, because it is what the node path has always produced. A
    // Python-only repo has no LCOV and falls through to Cobertura, and a JVM
    // repo to JaCoCo.
    const reports = lcovs.length > 0 ? lcovs : coberturas.length > 0 ? coberturas : jacocos;
    const { summary: coverage, lowCoverageFiles } = combineCoverage(reports);
    const markdown = formatFindings(tests, coverage, testFailures, lintFindings, typecheckFindings, lowCoverageFiles.map((f) => ({
        ...f,
        file: relativeToWorkspace(f.file, workspace),
    })));
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