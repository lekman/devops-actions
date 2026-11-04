/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */

import { describe, expect, test } from "bun:test";
import {
  formatFindings,
  parseCobertura,
  parseCoberturaLowCoverage,
  parseJunit,
  parseJunitFailures,
  parseLcov,
  parseLcovLowCoverage,
  parseLintLog,
  parseTypecheckLog,
} from "../src/findings-tests";

describe("parseJunit", () => {
  test("reads root testsuites totals", () => {
    const xml =
      '<?xml version="1.0"?><testsuites name="bun" tests="98" failures="0" skipped="0" time="0.14"></testsuites>';
    expect(parseJunit(xml)).toEqual({ tests: 98, failures: 0, errors: 0, skipped: 0 });
  });

  test("captures failures and skipped", () => {
    const xml =
      '<testsuites name="x" tests="50" failures="3" skipped="2"></testsuites>';
    expect(parseJunit(xml)).toEqual({ tests: 50, failures: 3, errors: 0, skipped: 2 });
  });

  test("returns null when no testsuites element", () => {
    expect(parseJunit("<nothing/>")).toBeNull();
  });

  test("defaults missing attributes to 0", () => {
    const xml = '<testsuites tests="10"></testsuites>';
    expect(parseJunit(xml)).toEqual({ tests: 10, failures: 0, errors: 0, skipped: 0 });
  });
});

describe("parseLcov", () => {
  test("sums LF and LH across multiple records", () => {
    const info = [
      "TN:",
      "SF:src/a.ts",
      "LF:10",
      "LH:8",
      "end_of_record",
      "SF:src/b.ts",
      "LF:20",
      "LH:15",
      "end_of_record",
    ].join("\n");
    expect(parseLcov(info)).toEqual({ linesFound: 30, linesHit: 23 });
  });

  test("returns null when no LF lines", () => {
    expect(parseLcov("TN:\nSF:x.ts\nend_of_record")).toBeNull();
  });
});

describe("formatFindings", () => {
  test("all green with coverage", () => {
    const md = formatFindings(
      { tests: 100, failures: 0, errors: 0, skipped: 0 },
      { linesFound: 1000, linesHit: 920 },
    );
    expect(md).toBe(
      "🟢 **100/100 tests passed** · 🟢 **92.0% lines covered** (920/1000)",
    );
  });

  test("with failures and skipped", () => {
    const md = formatFindings({ tests: 10, failures: 2, errors: 0, skipped: 1 }, null);
    expect(md).toBe("🔴 **7/10 tests passed** · 2 failed · 1 skipped");
  });

  test("coverage only, no tests", () => {
    const md = formatFindings(null, { linesFound: 100, linesHit: 50 });
    expect(md).toBe("🔴 **50.0% lines covered** (50/100)");
  });

  test("returns empty string when both inputs null", () => {
    expect(formatFindings(null, null)).toBe("");
  });

  test("coverage emoji thresholds", () => {
    // 85% → green
    expect(formatFindings(null, { linesFound: 100, linesHit: 85 })).toContain(
      "🟢",
    );
    // 70% → yellow
    expect(formatFindings(null, { linesFound: 100, linesHit: 70 })).toContain(
      "🟡",
    );
    // 50% → red
    expect(formatFindings(null, { linesFound: 100, linesHit: 50 })).toContain(
      "🔴",
    );
  });

  test("ignores zero-line coverage", () => {
    expect(formatFindings(null, { linesFound: 0, linesHit: 0 })).toBe("");
  });
});

describe("parseJunitFailures", () => {
  test("extracts failing test names and files", () => {
    const xml = `<testsuites tests="3" failures="1">
      <testsuite name="math">
        <testcase name="adds" file="src/math.test.ts" line="5"><failure>boom</failure></testcase>
        <testcase name="subtracts" file="src/math.test.ts" line="10" />
      </testsuite>
    </testsuites>`;
    const findings = parseJunitFailures(xml);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("src/math.test.ts:5");
    expect(findings[0].message).toBe("adds");
    expect(findings[0].level).toBe("error");
  });

  test("returns empty array when no failures", () => {
    const xml = `<testsuites tests="2" failures="0">
      <testsuite><testcase name="ok" file="a.ts" /></testsuite>
    </testsuites>`;
    expect(parseJunitFailures(xml)).toHaveLength(0);
  });
});

describe("parseLintLog", () => {
  test("parses Biome format errors", () => {
    const log = [
      "package.json format ━━━━━━━━━━━━━",
      "",
      "  × Formatter would have printed the following content:",
      "",
    ].join("\n");
    const findings = parseLintLog(log);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("package.json");
    expect(findings[0].message).toContain("Formatter would have printed");
  });

  test("parses ESLint stylish format", () => {
    const log = [
      "src/index.ts",
      "  12:5  error  Missing semicolon  semi",
      "  20:1  warning  Unexpected var  no-var",
      "",
    ].join("\n");
    const findings = parseLintLog(log);
    expect(findings).toHaveLength(2);
    expect(findings[0].file).toBe("src/index.ts:12:5");
    expect(findings[0].message).toBe("Missing semicolon");
    expect(findings[0].level).toBe("error");
    expect(findings[1].level).toBe("warning");
  });

  test("returns empty for clean output", () => {
    expect(parseLintLog("All checks passed!\n")).toHaveLength(0);
  });
});

describe("parseTypecheckLog", () => {
  test("parses tsc error lines", () => {
    const log = [
      "src/foo.ts(12,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
      "src/bar.ts(3,1): error TS1005: ';' expected.",
    ].join("\n");
    const findings = parseTypecheckLog(log);
    expect(findings).toHaveLength(2);
    expect(findings[0].file).toBe("src/foo.ts:12:5");
    expect(findings[0].message).toContain("TS2345");
    expect(findings[1].file).toBe("src/bar.ts:3:1");
  });

  test("returns empty for clean tsc output", () => {
    expect(parseTypecheckLog("")).toHaveLength(0);
  });
});

describe("parseLcovLowCoverage", () => {
  test("returns files below 80% threshold sorted by coverage ascending", () => {
    const info = [
      "SF:src/a.ts",
      "LF:100",
      "LH:90",
      "end_of_record", // 90% — above threshold
      "SF:src/b.ts",
      "LF:100",
      "LH:50",
      "end_of_record", // 50% — below
      "SF:src/c.ts",
      "LF:100",
      "LH:70",
      "end_of_record", // 70% — below
      "SF:src/d.ts",
      "LF:10",
      "LH:2",
      "end_of_record", // 20% — below
    ].join("\n");
    const files = parseLcovLowCoverage(info);
    expect(files).toHaveLength(3);
    // Sorted worst first
    expect(files[0].file).toBe("src/d.ts");
    expect(files[0].pct).toBeCloseTo(20);
    expect(files[1].file).toBe("src/b.ts");
    expect(files[2].file).toBe("src/c.ts");
  });

  test("returns empty when all files above threshold", () => {
    const info = [
      "SF:src/a.ts",
      "LF:10",
      "LH:9",
      "end_of_record",
      "SF:src/b.ts",
      "LF:10",
      "LH:10",
      "end_of_record",
    ].join("\n");
    expect(parseLcovLowCoverage(info)).toHaveLength(0);
  });

  test("skips files with zero lines", () => {
    const info = "SF:empty.ts\nLF:0\nLH:0\nend_of_record";
    expect(parseLcovLowCoverage(info)).toHaveLength(0);
  });
});

describe("formatFindings (with tables)", () => {
  test("renders lint error table", () => {
    const md = formatFindings(
      null,
      null,
      [],
      [{ file: "src/x.ts:5:1", message: "Missing semicolon", level: "error" }],
    );
    expect(md).toContain("**Lint errors** (1)");
    expect(md).toContain("| `src/x.ts:5:1` | Missing semicolon |");
  });

  test("renders low coverage files table", () => {
    const md = formatFindings(
      { tests: 10, failures: 0, errors: 0, skipped: 0 },
      { linesFound: 100, linesHit: 60 },
      [],
      [],
      [],
      [
        { file: "src/foo.ts", linesFound: 50, linesHit: 10, pct: 20 },
        { file: "src/bar.ts", linesFound: 30, linesHit: 15, pct: 50 },
      ],
    );
    expect(md).toContain("**Low coverage files** (<80%)");
    expect(md).toContain("| `src/foo.ts` | 20.0% | 10/50 |");
    expect(md).toContain("| `src/bar.ts` | 50.0% | 15/30 |");
  });

  test("renders combined summary + tables", () => {
    const md = formatFindings(
      { tests: 10, failures: 1, errors: 0, skipped: 0 },
      { linesFound: 100, linesHit: 85 },
      [{ file: "a.test.ts:3", message: "should work", level: "error" }],
      [{ file: "b.ts:1:1", message: "no-unused-vars", level: "error" }],
      [{ file: "c.ts:5:2", message: "TS2345: type mismatch", level: "error" }],
    );
    expect(md).toContain("🔴 **9/10 tests passed**");
    expect(md).toContain("🟢 **85.0% lines covered**");
    expect(md).toContain("**Lint errors** (1)");
    expect(md).toContain("**Type errors** (1)");
    expect(md).toContain("**Failing tests** (1)");
  });
});

// ─── Python ──────────────────────────────────────────────────────────────
//
// The XML below is verbatim output from pytest 9.1.1 and coverage.py
// 7.16.0, captured rather than hand-written. Both formats differ from
// bun's in ways that read as green when parsed with the node assumptions:
// pytest leaves the root <testsuites> bare, self-closes passing testcases,
// and reports collection failures as errors rather than failures.

const PYTEST_JUNIT = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="0" failures="1" skipped="1" tests="3" time="0.010" timestamp="2026-09-09T10:08:30.410590+01:00" hostname="MacBook.local"><testcase classname="test_sample" name="test_pass" time="0.000" /><testcase classname="test_sample" name="test_fail" time="0.000"><failure message="assert 1 == 2">def test_fail():
&gt;       assert 1 == 2
E       assert 1 == 2

test_sample.py:7: AssertionError</failure></testcase><testcase classname="test_sample" name="test_skipped" time="0.000"><skipped type="pytest.skip" message="demo">test_sample.py:9: demo</skipped></testcase></testsuite></testsuites>`;

const PYTEST_COLLECTION_ERROR = `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" errors="1" failures="0" skipped="0" tests="1" time="0.051"><testcase classname="" name="test_broken" time="0.000"><error message="collection failure">ImportError while importing test module</error></testcase></testsuite></testsuites>`;

const COBERTURA = `<?xml version="1.0" ?>
<coverage version="7.16.0" timestamp="1788944932933" lines-valid="8" lines-covered="7" line-rate="0.875" branches-covered="0" branches-valid="0" branch-rate="0" complexity="0">
	<sources><source>/repo</source></sources>
	<packages>
		<package name="." line-rate="0.875" branch-rate="0" complexity="0">
			<classes>
				<class name="app.py" filename="src/app.py" complexity="0" line-rate="0.875" branch-rate="0">
					<methods/>
					<lines>
						<line number="1" hits="1"/>
						<line number="3" hits="1"/>
						<line number="4" hits="1"/>
						<line number="6" hits="1"/>
						<line number="7" hits="1"/>
						<line number="9" hits="1"/>
						<line number="10" hits="1"/>
						<line number="11" hits="0"/>
					</lines>
				</class>
			</classes>
		</package>
	</packages>
</coverage>`;

describe("parseJunit — pytest", () => {
  test("sums the suites when the root element carries no totals", () => {
    expect(parseJunit(PYTEST_JUNIT)).toEqual({
      tests: 3,
      failures: 1,
      errors: 0,
      skipped: 1,
    });
  });

  test("counts a collection error", () => {
    expect(parseJunit(PYTEST_COLLECTION_ERROR)).toEqual({
      tests: 1,
      failures: 0,
      errors: 1,
      skipped: 0,
    });
  });

  test("sums across several suites", () => {
    const xml = `<testsuites name="pytest tests">
      <testsuite name="a" tests="2" failures="1" errors="0" skipped="0"></testsuite>
      <testsuite name="b" tests="3" failures="0" errors="1" skipped="1"></testsuite>
    </testsuites>`;
    expect(parseJunit(xml)).toEqual({
      tests: 5,
      failures: 1,
      errors: 1,
      skipped: 1,
    });
  });

  test("root totals still win when present", () => {
    const xml = `<testsuites tests="9" failures="2" errors="0" skipped="0">
      <testsuite name="a" tests="1" failures="0" errors="0" skipped="0"></testsuite>
    </testsuites>`;
    expect(parseJunit(xml)).toEqual({
      tests: 9,
      failures: 2,
      errors: 0,
      skipped: 0,
    });
  });
});

describe("parseJunitFailures — pytest", () => {
  test("names the test that actually failed, not the one before it", () => {
    const findings = parseJunitFailures(PYTEST_JUNIT);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe("test_fail");
  });

  test("falls back to classname when there is no file attribute", () => {
    expect(parseJunitFailures(PYTEST_JUNIT)[0].file).toBe("test_sample");
  });

  test("treats an error element as a failure", () => {
    const findings = parseJunitFailures(PYTEST_COLLECTION_ERROR);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe("test_broken");
  });

  test("does not report a skipped test as failing", () => {
    const names = parseJunitFailures(PYTEST_JUNIT).map((f) => f.message);
    expect(names).not.toContain("test_skipped");
    expect(names).not.toContain("test_pass");
  });
});

describe("parseCobertura", () => {
  test("reads the root line counts", () => {
    expect(parseCobertura(COBERTURA)).toEqual({
      linesFound: 8,
      linesHit: 7,
    });
  });

  test("counts line elements when the root gives only a rate", () => {
    const xml = `<coverage line-rate="0.5">
      <lines><line number="1" hits="1"/><line number="2" hits="0"/></lines>
    </coverage>`;
    expect(parseCobertura(xml)).toEqual({ linesFound: 2, linesHit: 1 });
  });

  test("returns null when there is no coverage element", () => {
    expect(parseCobertura("<nothing/>")).toBeNull();
  });

  test("returns null for a coverage element with no lines at all", () => {
    expect(parseCobertura('<coverage line-rate="0"></coverage>')).toBeNull();
  });
});

describe("parseCoberturaLowCoverage", () => {
  test("reports a file below the threshold with its line counts", () => {
    const xml = `<coverage>
      <class filename="src/app.py"><lines>
        <line number="1" hits="1"/><line number="2" hits="1"/>
        <line number="3" hits="0"/><line number="4" hits="0"/>
      </lines></class>
    </coverage>`;
    const files = parseCoberturaLowCoverage(xml);
    expect(files).toHaveLength(1);
    expect(files[0].file).toBe("src/app.py");
    expect(files[0].linesFound).toBe(4);
    expect(files[0].linesHit).toBe(2);
    expect(files[0].pct).toBeCloseTo(50, 1);
  });

  test("omits files at or above the threshold", () => {
    // The captured report is 7/8 = 87.5%, which clears the 80% bar.
    expect(parseCoberturaLowCoverage(COBERTURA)).toEqual([]);
  });

  test("sorts worst first", () => {
    const xml = `<coverage>
      <class filename="src/mid.py"><lines>
        <line number="1" hits="1"/><line number="2" hits="0"/>
      </lines></class>
      <class filename="src/bad.py"><lines>
        <line number="1" hits="0"/><line number="2" hits="0"/>
      </lines></class>
    </coverage>`;
    expect(parseCoberturaLowCoverage(xml).map((f) => f.file)).toEqual([
      "src/bad.py",
      "src/mid.py",
    ]);
  });
});

describe("parseLintLog — Python", () => {
  test("parses ruff findings", () => {
    const log = [
      "src/app.py:12:5: F401 [*] `os` imported but unused",
      "src/app.py:20:1: E402 module level import not at top of file",
      "Found 2 errors.",
    ].join("\n");
    const findings = parseLintLog(log);
    expect(findings).toHaveLength(2);
    expect(findings[0].file).toBe("src/app.py:12:5");
    expect(findings[0].message).toBe("F401: `os` imported but unused");
    expect(findings[1].message).toBe(
      "E402: module level import not at top of file",
    );
  });

  test("parses black findings", () => {
    const log = [
      "would reformat src/app.py",
      "would reformat tests/test_app.py",
      "2 files would be reformatted.",
    ].join("\n");
    const findings = parseLintLog(log);
    expect(findings).toHaveLength(2);
    expect(findings[0].file).toBe("src/app.py");
    expect(findings[0].message).toBe("would be reformatted by black");
  });

  test("reads a merged ruff and ESLint log without confusing the two", () => {
    const log = [
      "=== ruff ===",
      "src/app.py:12:5: F401 `os` imported but unused",
      "",
      "src/index.ts",
      "  3:1  error  Unexpected console statement  no-console",
    ].join("\n");
    const files = parseLintLog(log).map((f) => f.file);
    expect(files).toEqual(["src/app.py:12:5", "src/index.ts:3:1"]);
  });
});

describe("parseTypecheckLog — mypy", () => {
  test("parses mypy errors", () => {
    const log = [
      'src/app.py:12: error: Incompatible types in assignment  [assignment]',
      'src/app.py:19: note: Consider using a Protocol',
      'src/util.py:4:9: error: Missing return statement  [return]',
      "Found 2 errors in 2 files",
    ].join("\n");
    const findings = parseTypecheckLog(log);
    expect(findings).toHaveLength(2);
    expect(findings[0].file).toBe("src/app.py:12");
    expect(findings[0].message).toBe(
      "Incompatible types in assignment  [assignment]",
    );
    expect(findings[1].file).toBe("src/util.py:4:9");
  });

  test("leaves note lines out", () => {
    const log = "src/app.py:19: note: Consider using a Protocol";
    expect(parseTypecheckLog(log)).toEqual([]);
  });

  test("reads a merged tsc and mypy log", () => {
    const log = [
      "src/index.ts(3,10): error TS2322: Type 'string' is not assignable",
      "src/app.py:12: error: Incompatible types  [assignment]",
    ].join("\n");
    expect(parseTypecheckLog(log).map((f) => f.file)).toEqual([
      "src/index.ts:3:10",
      "src/app.py:12",
    ]);
  });
});

describe("formatFindings — errored tests", () => {
  test("an errored run is red and says so", () => {
    const md = formatFindings(
      { tests: 1, failures: 0, errors: 1, skipped: 0 },
      null,
    );
    expect(md).toContain("🔴");
    expect(md).toContain("0/1 tests passed");
    expect(md).toContain("1 errored");
  });
});
