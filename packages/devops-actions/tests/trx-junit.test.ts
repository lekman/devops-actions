/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseJunit, parseJunitFailures } from "../src/findings-tests";
import { escapeXml, parseDuration, parseTrx, toJunit } from "../src/trx-junit";

const REPORTS = resolve(import.meta.dir, "fixtures", "reports");
const read = (name: string): string =>
  readFileSync(resolve(REPORTS, name), "utf8");

describe("parseTrx", () => {
  test("reads a VSTest TRX with passed, failed, skipped and data-driven tests", () => {
    // vstest.trx comes from `dotnet test --logger trx` on an xUnit.net v3
    // project (xunit.v3.mtp-off) with four tests.
    const cases = parseTrx(read("vstest.trx"));
    expect(cases).not.toBeNull();
    const byName = new Map(cases?.map((c) => [c.name, c]));
    expect([...byName.keys()].sort()).toEqual([
      'Data(v: "a.b")',
      "Fails",
      "GreetsByName",
      "Skipped",
    ]);
    expect(new Set(cases?.map((c) => c.className))).toEqual(
      new Set(["Acme.Greeter.Tests.GreeterTests"]),
    );
    expect(byName.get("GreetsByName")?.outcome).toBe("passed");
    expect(byName.get("Skipped")?.outcome).toBe("skipped");
    const failed = byName.get("Fails");
    expect(failed?.outcome).toBe("failed");
    expect(failed?.message).toContain("Assert.Equal() Failure");
    expect(failed?.stackTrace).toContain("GreeterTests.Fails()");
  });

  test("reads xUnit.net v3's own TRX on the Microsoft Testing Platform", () => {
    const cases = parseTrx(read("mtp-xunit.trx"));
    expect(cases).toEqual([
      {
        className: "Acme.Greeter.Tests.GreeterTests",
        name: "GreetsByName",
        time: expect.any(Number),
        outcome: "passed",
        message: undefined,
        stackTrace: undefined,
      },
    ]);
  });

  test("reports a data-driven parent once, not its inner results", () => {
    const trx = [
      '<TestRun><Results><UnitTestResult testId="1" testName="A.B.Rows" outcome="Failed" duration="00:00:01.5">',
      "<InnerResults>",
      '<UnitTestResult testId="1" testName="A.B.Rows (1)" outcome="Passed"/>',
      '<UnitTestResult testId="1" testName="A.B.Rows (2)" outcome="Failed"/>',
      "</InnerResults></UnitTestResult></Results>",
      '<TestDefinitions><UnitTest id="1" name="Rows"><TestMethod className="A.B" name="Rows"/></UnitTest></TestDefinitions>',
      "</TestRun>",
    ].join("");
    expect(parseTrx(trx)).toEqual([
      {
        className: "A.B",
        name: "Rows",
        time: 1.5,
        outcome: "failed",
        message: undefined,
        stackTrace: undefined,
      },
    ]);
  });

  test("takes the class from the test name when there is no definition", () => {
    const trx =
      '<TestRun><Results><UnitTestResult testName="Acme.Tests.T.Run(x: &quot;1.5&quot;)" outcome="Timeout"/></Results></TestRun>';
    expect(parseTrx(trx)?.[0]).toMatchObject({
      className: "Acme.Tests.T",
      name: 'Run(x: "1.5")',
      outcome: "error",
    });
  });

  test("returns null for something that is not TRX", () => {
    expect(parseTrx("<testsuites/>")).toBeNull();
  });
});

describe("toJunit", () => {
  test("round-trips through the JUnit reader with the same counts", () => {
    const xml = toJunit(parseTrx(read("vstest.trx")) ?? []);
    expect(parseJunit(xml)).toEqual({
      tests: 4,
      failures: 1,
      errors: 0,
      skipped: 1,
    });
    expect(parseJunitFailures(xml)).toEqual([
      {
        file: "Acme.Greeter.Tests.GreeterTests",
        message: "Fails",
        level: "error",
      },
    ]);
  });

  test("writes errors and skips as their own elements", () => {
    const xml = toJunit([
      {
        className: "A",
        name: "boom",
        time: 0,
        outcome: "error",
        message: "crashed",
      },
      { className: "A", name: "later", time: 0, outcome: "skipped" },
    ]);
    expect(xml).toContain('<error message="crashed">crashed</error>');
    expect(xml).toContain("<skipped/>");
    expect(parseJunit(xml)).toEqual({
      tests: 2,
      failures: 0,
      errors: 1,
      skipped: 1,
    });
  });

  test("escapes names and messages", () => {
    const xml = toJunit([
      {
        className: "A<B>",
        name: 'x "y" & z',
        time: 0,
        outcome: "failed",
        message: "<bad>",
      },
    ]);
    expect(xml).toContain('name="x &quot;y&quot; &amp; z"');
    expect(xml).toContain('classname="A&lt;B&gt;"');
    expect(xml).toContain('message="&lt;bad&gt;"');
  });
});

describe("helpers", () => {
  test.each([
    ["00:00:00.0060000", 0.006],
    ["01:02:03.5", 3723.5],
    [undefined, 0],
    ["bad", 0],
  ])("parseDuration(%p) is %p", (input, expected) => {
    expect(parseDuration(input)).toBeCloseTo(expected, 6);
  });

  test("escapeXml drops control characters XML cannot hold", () => {
    expect(escapeXml("a\u0001b\tc")).toBe("ab\tc");
  });
});
