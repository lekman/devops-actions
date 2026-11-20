/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Converts Visual Studio TRX test results into JUnit XML.
 *
 * `dotnet test` writes TRX on both test platforms: VSTest with its built-in
 * `trx` logger, and the Microsoft Testing Platform with `--report-trx` (the
 * TRX report extension) or xUnit.net v3's own `--report-xunit-trx`. JUnit
 * is the format the rest of the shared CI reads (findings-tests, test
 * report check runs), so the dotnet-quality action converts once here
 * rather than every consumer learning TRX.
 *
 * Mapping:
 *
 *   Passed                              <testcase/>
 *   Failed                              <testcase><failure/></testcase>
 *   Error, Timeout, Aborted             <testcase><error/></testcase>
 *   NotExecuted, Inconclusive, other    <testcase><skipped/></testcase>
 *
 * Results are grouped into one `<testsuite>` per test class, named from
 * the TRX test definition. Data-driven tests that TRX nests under
 * `<InnerResults>` are reported once, by their parent result.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expandReportPaths, readAll } from "./coverage.js";
function attr(tag, name) {
    const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
    return m ? decodeXml(m[1]) : undefined;
}
function decodeXml(text) {
    return text
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&amp;/g, "&");
}
/** Escape text for an XML attribute or element body. */
export function escapeXml(text) {
    return (text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        // Control characters other than tab, newline and carriage return are
        // not allowed in XML 1.0 at all, even escaped.
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""));
}
/** Read a TRX `hh:mm:ss.fffffff` duration as seconds. */
export function parseDuration(duration) {
    const m = duration?.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
    if (!m)
        return 0;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
function toOutcome(outcome) {
    switch (outcome) {
        case "Passed":
        case "PassedButRunAborted":
            return "passed";
        case "Failed":
            return "failed";
        case "Error":
        case "Timeout":
        case "Aborted":
            return "error";
        default:
            return "skipped";
    }
}
function elementText(body, name) {
    const m = body.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
    return m ? decodeXml(m[1]).trim() : undefined;
}
/**
 * Read the test cases from one TRX document.
 *
 * @param trx TRX file contents.
 * @returns The cases, or null when the document is not TRX.
 */
export function parseTrx(trx) {
    if (!/<TestRun\b/.test(trx))
        return null;
    // Map each test id to its class, from the test definitions.
    const classes = new Map();
    const unitTestRe = /<UnitTest\b([^>]*)>([\s\S]*?)<\/UnitTest>/g;
    for (let m = unitTestRe.exec(trx); m !== null; m = unitTestRe.exec(trx)) {
        const id = attr(m[1], "id");
        const method = m[2].match(/<TestMethod\b[^>]*>/)?.[0];
        const className = method ? attr(method, "className") : undefined;
        if (id && className)
            classes.set(id, className);
    }
    const topLevel = trx.replace(/<InnerResults>[\s\S]*?<\/InnerResults>/g, "");
    const cases = [];
    const resultRe = /<UnitTestResult\b([^>]*?)(\/>|>([\s\S]*?)<\/UnitTestResult>)/g;
    for (let m = resultRe.exec(topLevel); m !== null; m = resultRe.exec(topLevel)) {
        const attrs = m[1];
        const body = m[3] ?? "";
        const testName = attr(attrs, "testName") ?? "unknown";
        const testId = attr(attrs, "testId") ?? "";
        let className = classes.get(testId) ?? "";
        let name = testName;
        // TRX names a test by its full name. Keep the part after the class,
        // so `Acme.Tests.GreeterTests.GreetsByName` reads `GreetsByName` under
        // the `Acme.Tests.GreeterTests` suite.
        if (className && name.startsWith(`${className}.`)) {
            name = name.slice(className.length + 1);
        }
        else if (!className) {
            // Parameters can hold dots, so look for the last one before them.
            const paren = testName.indexOf("(");
            const dot = testName.lastIndexOf(".", paren === -1 ? testName.length : paren);
            className = dot > 0 ? testName.slice(0, dot) : "tests";
            name = dot > 0 ? testName.slice(dot + 1) : testName;
        }
        const outcome = toOutcome(attr(attrs, "outcome"));
        const errorInfo = body.match(/<ErrorInfo>([\s\S]*?)<\/ErrorInfo>/)?.[1] ?? "";
        cases.push({
            className,
            name,
            time: parseDuration(attr(attrs, "duration")),
            outcome,
            message: elementText(errorInfo, "Message"),
            stackTrace: elementText(errorInfo, "StackTrace"),
        });
    }
    return cases;
}
/**
 * Render test cases as one JUnit XML document, a `<testsuite>` per class.
 *
 * @param cases Cases from one or more TRX files.
 */
export function toJunit(cases) {
    const suites = new Map();
    for (const c of cases) {
        const list = suites.get(c.className) ?? [];
        list.push(c);
        suites.set(c.className, list);
    }
    const count = (list, outcome) => list.filter((c) => c.outcome === outcome).length;
    const seconds = (list) => list.reduce((sum, c) => sum + c.time, 0).toFixed(3);
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<testsuites name="dotnet test" tests="${cases.length}" failures="${count(cases, "failed")}" errors="${count(cases, "error")}" skipped="${count(cases, "skipped")}" time="${seconds(cases)}">`,
    ];
    for (const [className, list] of [...suites].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`  <testsuite name="${escapeXml(className)}" tests="${list.length}" failures="${count(list, "failed")}" errors="${count(list, "error")}" skipped="${count(list, "skipped")}" time="${seconds(list)}">`);
        for (const c of list) {
            const open = `    <testcase name="${escapeXml(c.name)}" classname="${escapeXml(className)}" time="${c.time.toFixed(3)}"`;
            if (c.outcome === "passed") {
                lines.push(`${open}/>`);
                continue;
            }
            lines.push(`${open}>`);
            if (c.outcome === "skipped") {
                lines.push(`      <skipped${c.message ? ` message="${escapeXml(c.message)}"` : ""}/>`);
            }
            else {
                const tag = c.outcome === "failed" ? "failure" : "error";
                const message = escapeXml(c.message ?? c.outcome);
                lines.push(`      <${tag} message="${message}">${escapeXml(c.stackTrace ?? c.message ?? "")}</${tag}>`);
            }
            lines.push("    </testcase>");
        }
        lines.push("  </testsuite>");
    }
    lines.push("</testsuites>");
    return `${lines.join("\n")}\n`;
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
        console.error("trx-junit: --out is required");
        process.exit(1);
    }
    const files = expandReportPaths(args.get("trx") ?? "", [".trx"]);
    const cases = [];
    let read = 0;
    for (const text of readAll(files)) {
        const parsed = parseTrx(text);
        if (!parsed)
            continue;
        read += 1;
        cases.push(...parsed);
    }
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (read === 0) {
        console.log("::warning title=Tests::no TRX test results were found, so no JUnit report was written");
        if (githubOutput)
            appendFileSync(githubOutput, "junit-path=\n");
        return;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, toJunit(cases));
    if (githubOutput)
        appendFileSync(githubOutput, `junit-path=${out}\n`);
    console.log(`trx-junit: ${cases.length} tests from ${read} TRX file(s) → ${out}`);
}
if (import.meta.main) {
    main();
}
/* eslint-enable no-console */
//# sourceMappingURL=trx-junit.js.map