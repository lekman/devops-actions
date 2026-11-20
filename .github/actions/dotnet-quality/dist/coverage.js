/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Line coverage from the three report formats the shared CI meets:
 *
 *   LCOV       bun, jest, vitest, c8
 *   Cobertura  pytest-cov, coverage.py, coverlet, Microsoft code coverage
 *   JaCoCo     JaCoCo and Kover (Kover writes JaCoCo's XML format)
 *
 * Used by findings-tests for the gate comment and by coverage-check for
 * the coverage floor, so both read the same number.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
export const MAX_LOW_COVERAGE_FILES = 20;
export const COVERAGE_THRESHOLD = 80;
function numericAttr(tag, name) {
    const m = tag.match(new RegExp(`\\b${name}="(\\d+)"`));
    return m ? Number(m[1]) : 0;
}
// ---- LCOV ----
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
 * by coverage % ascending (worst first), capped at MAX_LOW_COVERAGE_FILES.
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
    return worstFirst(files);
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
 * COVERAGE_THRESHOLD, worst first, capped at MAX_LOW_COVERAGE_FILES.
 *
 * Per-class elements carry `line-rate` but no line counts, so the counts
 * come from the `<line hits="...">` children inside each `<class>`.
 * coverlet and Microsoft code coverage write one `<class>` per type, so
 * classes sharing a file are added up before the threshold applies.
 */
export function parseCoberturaLowCoverage(xml) {
    const files = [];
    for (const [file, lines] of coberturaLines(xml)) {
        const linesFound = lines.size;
        const linesHit = [...lines.values()].filter(Boolean).length;
        const pct = (linesHit / linesFound) * 100;
        if (pct < COVERAGE_THRESHOLD) {
            files.push({ file, linesFound, linesHit, pct });
        }
    }
    return worstFirst(files);
}
// ---- JaCoCo ----
/** Read the LINE counter from a run of JaCoCo XML, or null when absent. */
function lineCounter(xml) {
    const re = /<counter\b[^>]*\btype="LINE"[^>]*\/?>/g;
    let last = null;
    for (let m = re.exec(xml); m !== null; m = re.exec(xml))
        last = m[0];
    if (!last)
        return null;
    const missed = numericAttr(last, "missed");
    const covered = numericAttr(last, "covered");
    return { linesFound: missed + covered, linesHit: covered };
}
/**
 * Parse a JaCoCo XML report, as JaCoCo and Kover write it. The totals are
 * the `<counter type="LINE">` directly under `<report>`, after every
 * `<group>` and `<package>`:
 *
 *   <report name="x"> <package>…</package> <counter type="LINE" missed="6" covered="1"/> </report>
 *
 * Checked against the reports Gradle 9.9.1's JaCoCo plugin and Kover
 * 0.9.11 write. The nested blocks are removed first, so only the report's
 * own counters remain.
 */
export function parseJacoco(xml) {
    if (!/<report\b/.test(xml))
        return null;
    const topLevel = xml
        .replace(/<group\b[\s\S]*?<\/group>/g, "")
        .replace(/<package\b[\s\S]*?<\/package>/g, "");
    return lineCounter(topLevel);
}
/**
 * Parse JaCoCo per-file coverage from its `<sourcefile>` elements, named
 * `<package>/<file>` (e.g. `com/acme/Greeter.kt`). Returns files below
 * COVERAGE_THRESHOLD, worst first, capped at MAX_LOW_COVERAGE_FILES.
 */
export function parseJacocoLowCoverage(xml) {
    const files = [];
    const packageRe = /<package\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/package>/g;
    for (let p = packageRe.exec(xml); p !== null; p = packageRe.exec(xml)) {
        const sourceRe = /<sourcefile\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/sourcefile>/g;
        for (let s = sourceRe.exec(p[2]); s !== null; s = sourceRe.exec(p[2])) {
            const counter = lineCounter(s[2]);
            if (!counter || counter.linesFound === 0)
                continue;
            const pct = (counter.linesHit / counter.linesFound) * 100;
            if (pct < COVERAGE_THRESHOLD) {
                const file = p[1] ? `${p[1]}/${s[1]}` : s[1];
                files.push({ file, ...counter, pct });
            }
        }
    }
    return worstFirst(files);
}
// ---- Several reports ----
/**
 * Tell the format of a report from its content. LCOV is text with `SF:`
 * records, Cobertura's root is `<coverage>`, JaCoCo's is `<report>`.
 */
export function detectCoverageFormat(text) {
    if (/<coverage\b/.test(text))
        return "cobertura";
    if (/<report\b/.test(text) && /<counter\b/.test(text))
        return "jacoco";
    if (/^(SF|LF):/m.test(text))
        return "lcov";
    return null;
}
/** Parse one report of a known format. */
export function parseCoverage(text, format) {
    if (format === "lcov")
        return parseLcov(text);
    if (format === "cobertura")
        return parseCobertura(text);
    return parseJacoco(text);
}
/** Per-file coverage below the threshold for one report of a known format. */
export function parseLowCoverage(text, format) {
    if (format === "lcov")
        return parseLcovLowCoverage(text);
    if (format === "cobertura")
        return parseCoberturaLowCoverage(text);
    return parseJacocoLowCoverage(text);
}
/**
 * Line hits per file from a Cobertura report: file to line number to
 * whether any hit was recorded. A line listed under a method and again
 * under its class counts once.
 */
export function coberturaLines(xml) {
    const files = new Map();
    const classRe = /<class\b([^>]*)>([\s\S]*?)<\/class>/g;
    for (let m = classRe.exec(xml); m !== null; m = classRe.exec(xml)) {
        const file = m[1].match(/\bfilename="([^"]*)"/)?.[1];
        if (!file)
            continue;
        const lines = files.get(file) ?? new Map();
        const lineRe = /<line\b([^>]*)\/?>/g;
        for (let l = lineRe.exec(m[2]); l !== null; l = lineRe.exec(m[2])) {
            const number = l[1].match(/\bnumber="(\d+)"/)?.[1];
            const hits = l[1].match(/\bhits="(\d+)"/)?.[1];
            if (number === undefined || hits === undefined)
                continue;
            lines.set(number, (lines.get(number) ?? false) || Number(hits) > 0);
        }
        if (lines.size > 0)
            files.set(file, lines);
    }
    return files;
}
/**
 * Merge Cobertura reports line by line. VSTest writes one report per test
 * project, and two test projects that exercise the same library both list
 * its lines. Adding their totals would count those lines twice, so the
 * union of covered lines is taken instead.
 */
function mergeCobertura(texts) {
    const merged = new Map();
    for (const text of texts) {
        for (const [file, lines] of coberturaLines(text)) {
            const into = merged.get(file) ?? new Map();
            for (const [line, hit] of lines)
                into.set(line, (into.get(line) ?? false) || hit);
            merged.set(file, into);
        }
    }
    if (merged.size === 0)
        return { summary: null, lowCoverageFiles: [] };
    let linesFound = 0;
    let linesHit = 0;
    const low = [];
    for (const [file, lines] of merged) {
        const found = lines.size;
        const hit = [...lines.values()].filter(Boolean).length;
        linesFound += found;
        linesHit += hit;
        const pct = (hit / found) * 100;
        if (pct < COVERAGE_THRESHOLD) {
            low.push({ file, linesFound: found, linesHit: hit, pct });
        }
    }
    return { summary: { linesFound, linesHit }, lowCoverageFiles: low };
}
/**
 * Combine several reports into one total.
 *
 * A multi-module Gradle or Maven build writes one JaCoCo report per module,
 * each covering only that module's classes, so their line counts are
 * added. Several Cobertura reports are merged line by line (see
 * mergeCobertura). A report that appears twice with the same content, as
 * VSTest leaves a copy beside its TRX file, is read once. Reports whose
 * format cannot be told, or that hold no line counts, are left out.
 *
 * @param texts Report contents.
 * @returns The total, or a null summary when no report held line counts.
 */
export function combineCoverage(texts) {
    let linesFound = 0;
    let linesHit = 0;
    let any = false;
    const low = [];
    const cobertura = [];
    const seen = new Set();
    for (const text of texts) {
        if (seen.has(text))
            continue;
        seen.add(text);
        const format = detectCoverageFormat(text);
        if (!format)
            continue;
        if (format === "cobertura") {
            cobertura.push(text);
            continue;
        }
        const summary = parseCoverage(text, format);
        if (!summary)
            continue;
        any = true;
        linesFound += summary.linesFound;
        linesHit += summary.linesHit;
        low.push(...parseLowCoverage(text, format));
    }
    if (cobertura.length === 1) {
        const summary = parseCobertura(cobertura[0]);
        if (summary) {
            any = true;
            linesFound += summary.linesFound;
            linesHit += summary.linesHit;
            low.push(...parseCoberturaLowCoverage(cobertura[0]));
        }
    }
    else if (cobertura.length > 1) {
        const merged = mergeCobertura(cobertura);
        if (merged.summary) {
            any = true;
            linesFound += merged.summary.linesFound;
            linesHit += merged.summary.linesHit;
            low.push(...merged.lowCoverageFiles);
        }
    }
    return {
        summary: any ? { linesFound, linesHit } : null,
        lowCoverageFiles: worstFirst(low),
    };
}
/** Line coverage as a percentage, or null when there are no lines. */
export function linePercent(summary) {
    if (!summary || summary.linesFound === 0)
        return null;
    return (summary.linesHit / summary.linesFound) * 100;
}
function worstFirst(files) {
    return [...files]
        .sort((a, b) => a.pct - b.pct)
        .slice(0, MAX_LOW_COVERAGE_FILES);
}
// ---- Report paths ----
/**
 * Expand a list of report paths. Entries are separated by newlines or
 * commas. A file is taken as it is; a directory contributes every file
 * below it whose name ends with one of `extensions`. Missing paths are
 * skipped, and the result holds each file once, in a stable order.
 *
 * @param spec Paths as a caller passes them, e.g. an action input.
 * @param extensions File name endings to collect from directories.
 * @param base Directory that relative paths resolve against.
 */
export function expandReportPaths(spec, extensions, base = process.cwd()) {
    const out = new Set();
    for (const raw of spec.split(/[\n,]/)) {
        const entry = raw.trim();
        if (!entry)
            continue;
        const path = resolve(base, entry);
        if (!existsSync(path))
            continue;
        let stat;
        try {
            stat = statSync(path);
        }
        catch {
            continue;
        }
        if (stat.isFile()) {
            out.add(path);
        }
        else if (stat.isDirectory()) {
            for (const file of walk(path, 12)) {
                if (extensions.some((ext) => file.endsWith(ext)))
                    out.add(file);
            }
        }
    }
    return [...out];
}
function walk(dir, depth) {
    if (depth < 0)
        return [];
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const files = [];
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory())
            files.push(...walk(path, depth - 1));
        else if (entry.isFile())
            files.push(path);
    }
    return files;
}
/** Read each file, skipping any that cannot be read. */
export function readAll(paths) {
    const texts = [];
    for (const path of paths) {
        try {
            texts.push(readFileSync(path, "utf8"));
        }
        catch {
            // An unreadable report is the same as a missing one.
        }
    }
    return texts;
}
//# sourceMappingURL=coverage.js.map