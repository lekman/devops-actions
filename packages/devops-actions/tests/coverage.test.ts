/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { checkCoverage } from "../src/coverage-check";
import {
  combineCoverage,
  detectCoverageFormat,
  expandReportPaths,
  linePercent,
  parseJacoco,
  parseJacocoLowCoverage,
} from "../src/coverage";

const REPORTS = resolve(import.meta.dir, "fixtures", "reports");
const read = (name: string): string =>
  readFileSync(resolve(REPORTS, name), "utf8");

// A Cobertura report with one class, in the shape coverlet and Microsoft
// code coverage write: lines listed under each method and again under the
// class.
function cobertura(file: string, lines: Array<[number, number]>): string {
  const rows = lines
    .map(([n, hits]) => `<line number="${n}" hits="${hits}" branch="False" />`)
    .join("");
  const covered = lines.filter(([, h]) => h > 0).length;
  return [
    `<coverage line-rate="0" lines-covered="${covered}" lines-valid="${lines.length}">`,
    `<packages><package name="p"><classes>`,
    `<class name="C" filename="${file}"><methods><method name="m"><lines>${rows}</lines></method></methods>`,
    `<lines>${rows}</lines></class>`,
    `</classes></package></packages></coverage>`,
  ].join("");
}

describe("parseJacoco", () => {
  test("reads the report totals from a JaCoCo report", () => {
    // jacoco.xml is the jvm-gradle-bad fixture's report: 1 of 7 lines.
    expect(parseJacoco(read("jacoco.xml"))).toEqual({
      linesFound: 7,
      linesHit: 1,
    });
  });

  test("reads the report totals from a Kover report", () => {
    expect(parseJacoco(read("kover.xml"))).toEqual({
      linesFound: 1,
      linesHit: 1,
    });
  });

  test("ignores the counters inside groups and packages", () => {
    const xml = [
      '<report name="r"><group name="g"><package name="a">',
      '<counter type="LINE" missed="100" covered="0"/></package>',
      '<counter type="LINE" missed="100" covered="0"/></group>',
      '<counter type="LINE" missed="3" covered="9"/></report>',
    ].join("");
    expect(parseJacoco(xml)).toEqual({ linesFound: 12, linesHit: 9 });
  });

  test("returns null for something that is not a JaCoCo report", () => {
    expect(parseJacoco("<coverage/>")).toBeNull();
    expect(parseJacoco('<report name="r"></report>')).toBeNull();
  });
});

describe("parseJacocoLowCoverage", () => {
  test("names files by package and source file", () => {
    expect(parseJacocoLowCoverage(read("jacoco.xml"))).toEqual([
      {
        file: "com/acme/greeter/Greeter.kt",
        linesFound: 7,
        linesHit: 1,
        pct: (1 / 7) * 100,
      },
    ]);
  });

  test("leaves out files at or above the threshold", () => {
    expect(parseJacocoLowCoverage(read("kover.xml"))).toEqual([]);
  });
});

describe("detectCoverageFormat", () => {
  test.each([
    ["jacoco.xml", "jacoco"],
    ["kover.xml", "jacoco"],
  ])("%s is %s", (file, format) => {
    expect(detectCoverageFormat(read(file))).toBe(format as "jacoco");
  });

  test("Cobertura and LCOV are told apart", () => {
    expect(detectCoverageFormat(cobertura("a.cs", [[1, 1]]))).toBe("cobertura");
    expect(
      detectCoverageFormat("TN:\nSF:a.ts\nLF:1\nLH:1\nend_of_record"),
    ).toBe("lcov");
  });

  test("JUnit XML is no coverage format", () => {
    expect(detectCoverageFormat(read("gradle-junit.xml"))).toBeNull();
  });
});

describe("combineCoverage", () => {
  test("adds up JaCoCo reports from several modules", () => {
    const { summary } = combineCoverage([
      read("jacoco.xml"),
      read("kover.xml"),
    ]);
    expect(summary).toEqual({ linesFound: 8, linesHit: 2 });
  });

  test("merges Cobertura reports line by line", () => {
    // Two test projects both exercise lib.cs. Line 1 is hit by the first,
    // line 2 by the second, line 3 by neither.
    const a = cobertura("/w/lib.cs", [
      [1, 1],
      [2, 0],
      [3, 0],
    ]);
    const b = cobertura("/w/lib.cs", [
      [1, 0],
      [2, 4],
      [3, 0],
    ]);
    const { summary, lowCoverageFiles } = combineCoverage([a, b]);
    expect(summary).toEqual({ linesFound: 3, linesHit: 2 });
    expect(lowCoverageFiles.map((f) => f.file)).toEqual(["/w/lib.cs"]);
  });

  test("reads a report that appears twice once", () => {
    const report = cobertura("/w/lib.cs", [
      [1, 1],
      [2, 0],
    ]);
    expect(combineCoverage([report, report]).summary).toEqual({
      linesFound: 2,
      linesHit: 1,
    });
  });

  test("a single Cobertura report keeps its root totals", () => {
    const xml = '<coverage lines-valid="10" lines-covered="9"></coverage>';
    expect(combineCoverage([xml]).summary).toEqual({
      linesFound: 10,
      linesHit: 9,
    });
  });

  test("no readable report gives no summary", () => {
    expect(combineCoverage([]).summary).toBeNull();
    expect(combineCoverage(["not a report"]).summary).toBeNull();
  });

  test("linePercent is null with nothing to divide", () => {
    expect(linePercent(null)).toBeNull();
    expect(linePercent({ linesFound: 0, linesHit: 0 })).toBeNull();
    expect(linePercent({ linesFound: 4, linesHit: 3 })).toBe(75);
  });
});

describe("expandReportPaths", () => {
  let dir: string;

  beforeEach(() => {
    dir = resolve(
      tmpdir(),
      `report-paths-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(resolve(dir, "a/test-results/test"), { recursive: true });
    mkdirSync(resolve(dir, "b"), { recursive: true });
    writeFileSync(resolve(dir, "a/test-results/test/TEST-One.xml"), "");
    writeFileSync(resolve(dir, "a/test-results/test/binary.bin"), "");
    writeFileSync(resolve(dir, "b/TEST-Two.xml"), "");
    writeFileSync(resolve(dir, "single.info"), "");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("a directory stands for the matching files below it", () => {
    expect(expandReportPaths("a/test-results", [".xml"], dir)).toEqual([
      resolve(dir, "a/test-results/test/TEST-One.xml"),
    ]);
  });

  test("entries split on newlines and commas, files are taken as they are", () => {
    expect(expandReportPaths("a\nb, single.info", [".xml"], dir)).toEqual([
      resolve(dir, "a/test-results/test/TEST-One.xml"),
      resolve(dir, "b/TEST-Two.xml"),
      resolve(dir, "single.info"),
    ]);
  });

  test("missing paths are skipped and duplicates listed once", () => {
    expect(
      expandReportPaths("missing\nb\nb/TEST-Two.xml", [".xml"], dir),
    ).toEqual([resolve(dir, "b/TEST-Two.xml")]);
    expect(expandReportPaths("", [".xml"], dir)).toEqual([]);
  });
});

describe("checkCoverage", () => {
  test("passes at the threshold", () => {
    expect(checkCoverage({ linesFound: 10, linesHit: 8 }, 80)).toEqual({
      result: "passed",
      percent: "80.0",
      message: "line coverage 80.0% (8/10 lines) meets the 80% floor",
    });
  });

  test("fails below the threshold", () => {
    const verdict = checkCoverage({ linesFound: 7, linesHit: 1 }, 80);
    expect(verdict.result).toBe("failed");
    expect(verdict.percent).toBe("14.3");
    expect(verdict.message).toContain("is below the 80% floor");
  });

  test("a value that rounds up to the floor is shown with two decimals", () => {
    // 7999/10000 is 79.99%, which one decimal would show as 80.0%.
    const verdict = checkCoverage({ linesFound: 10000, linesHit: 7999 }, 80);
    expect(verdict.result).toBe("failed");
    expect(verdict.percent).toBe("79.99");
  });

  test("no report is a failure of its own kind", () => {
    expect(checkCoverage(null, 80).result).toBe("missing");
    expect(checkCoverage({ linesFound: 0, linesHit: 0 }, 80).result).toBe(
      "missing",
    );
  });

  test("a threshold of 0 passes any measured coverage", () => {
    expect(checkCoverage({ linesFound: 10, linesHit: 0 }, 0).result).toBe(
      "passed",
    );
  });
});
