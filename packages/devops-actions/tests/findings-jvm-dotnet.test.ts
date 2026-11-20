/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * The JVM and .NET formats findings-tests and findings-audit read. The
 * log lines are copied from real tool output: ktlint 1.8.0, detekt 1.23.8,
 * Kotlin 2.4.21 and javac 21 through Gradle 9.9.1 and Maven 3.9.16, Error
 * Prone 2.51.0, and the .NET 10 SDK's compiler and dotnet format.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  compareVersions,
  formatAuditFindings,
  parseDotnetPackageList,
  parseOsvScanner,
  readAuditResult,
} from "../src/findings-audit";
import {
  matchJvmCompiler,
  matchMsbuild,
  parseJunit,
  parseJunitFailures,
  parseLintLog,
  parseTypecheckLog,
  relativeToWorkspace,
  sumJunit,
} from "../src/findings-tests";

const REPORTS = resolve(import.meta.dir, "fixtures", "reports");
const read = (name: string): string =>
  readFileSync(resolve(REPORTS, name), "utf8");

describe("JUnit from Gradle and Maven", () => {
  test("reads a per-class file with a bare testsuite root", () => {
    expect(parseJunit(read("gradle-junit.xml"))).toEqual({
      tests: 1,
      failures: 0,
      errors: 0,
      skipped: 0,
    });
  });

  test("adds up the files of a test run", () => {
    const failing =
      '<testsuite name="B" tests="3" skipped="1" failures="1" errors="0"><testcase name="x()" classname="com.acme.B"><failure message="boom"/></testcase></testsuite>';
    expect(sumJunit([read("gradle-junit.xml"), failing, "<nothing/>"])).toEqual(
      {
        tests: 4,
        failures: 1,
        errors: 0,
        skipped: 1,
      },
    );
    expect(parseJunitFailures(failing)).toEqual([
      { file: "com.acme.B", message: "x()", level: "error" },
    ]);
  });

  test("no JUnit file at all gives no summary", () => {
    expect(sumJunit([])).toBeNull();
    expect(sumJunit(["<nothing/>"])).toBeNull();
  });
});

describe("lint logs", () => {
  test("ktlint plain reporter", () => {
    const log =
      '/w/src/main/kotlin/com/acme/Greeter.kt:8:20: Missing spacing after ":" (standard:colon-spacing)';
    expect(parseLintLog(log)).toEqual([
      {
        file: "/w/src/main/kotlin/com/acme/Greeter.kt:8:20",
        message: 'Missing spacing after ":" (standard:colon-spacing)',
        level: "error",
      },
    ]);
  });

  test("detekt console output, and its summary lines are skipped", () => {
    const log = [
      "/w/src/main/kotlin/com/acme/Greeter.kt:14:21: This expression contains a magic number. Consider defining it to a well named constant. [MagicNumber]",
      "",
      "Analysis failed with 5 weighted issues.",
    ].join("\n");
    expect(parseLintLog(log)).toEqual([
      {
        file: "/w/src/main/kotlin/com/acme/Greeter.kt:14:21",
        message:
          "This expression contains a magic number. Consider defining it to a well named constant. [MagicNumber]",
        level: "error",
      },
    ]);
  });

  test("a Kotlin build script is read too", () => {
    expect(
      parseLintLog(
        "/w/build.gradle.kts:3:1: Unexpected blank line(s) (standard:no-blank-line)",
      ),
    ).toHaveLength(1);
  });

  test("google-java-format, as jvm-quality writes it", () => {
    expect(
      parseLintLog("would reformat /w/src/main/java/com/acme/Greeter.java"),
    ).toEqual([
      {
        file: "/w/src/main/java/com/acme/Greeter.java",
        message: "would be reformatted by google-java-format",
        level: "error",
      },
    ]);
  });

  test("dotnet format", () => {
    const log =
      "/w/src/Acme.Greeter/Greeter.cs(11,45): error WHITESPACE: Fix whitespace formatting. Delete 2 characters. [/w/src/Acme.Greeter/Acme.Greeter.csproj]";
    expect(parseLintLog(log)).toEqual([
      {
        file: "/w/src/Acme.Greeter/Greeter.cs:11:45",
        message: "WHITESPACE: Fix whitespace formatting. Delete 2 characters.",
        level: "error",
      },
    ]);
  });
});

describe("compiler logs", () => {
  test.each([
    [
      "kotlinc through Gradle",
      "e: file:///w/src/main/kotlin/App.kt:3:5 Unresolved reference 'x'.",
      {
        file: "/w/src/main/kotlin/App.kt:3:5",
        message: "Unresolved reference 'x'.",
      },
    ],
    [
      "kotlinc through Maven",
      "[ERROR] file:///w/src/main/kotlin/App.kt:3:5 Unresolved reference 'x'.",
      {
        file: "/w/src/main/kotlin/App.kt:3:5",
        message: "Unresolved reference 'x'.",
      },
    ],
    [
      "javac through Gradle",
      "/w/src/main/java/App.java:3: error: cannot find symbol",
      { file: "/w/src/main/java/App.java:3", message: "cannot find symbol" },
    ],
    [
      "Error Prone through Maven",
      "[ERROR] /w/src/main/java/com/acme/greeter/Greeter.java:[16,7] [DeadException] Exception created but not thrown",
      {
        file: "/w/src/main/java/com/acme/greeter/Greeter.java:16:7",
        message: "[DeadException] Exception created but not thrown",
      },
    ],
  ])("%s", (_name, line, expected) => {
    expect(matchJvmCompiler(line)).toEqual({ ...expected, level: "error" });
  });

  test("a Kotlin warning is not an error", () => {
    expect(
      matchJvmCompiler("w: file:///w/App.kt:3:5 Parameter 'x' is never used"),
    ).toBeNull();
  });

  test("a C# analyzer error from the strict build", () => {
    const line =
      "/w/src/Acme.Greeter/Greeter.cs(14,45): error CA1305: The behavior of 'int.Parse(string)' could vary based on the current user's locale settings. [/w/src/Acme.Greeter/Acme.Greeter.csproj]";
    expect(matchMsbuild(line)).toEqual({
      file: "/w/src/Acme.Greeter/Greeter.cs:14:45",
      message:
        "CA1305: The behavior of 'int.Parse(string)' could vary based on the current user's locale settings.",
      level: "error",
    });
  });

  test("a C# warning is not an error", () => {
    expect(
      matchMsbuild("/w/A.cs(1,1): warning CS0168: unused [/w/A.csproj]"),
    ).toBeNull();
  });

  test("MSBuild's repeated summary lines are listed once", () => {
    const line =
      "/w/A.cs(1,2): error CS0103: The name 'x' does not exist [/w/A.csproj]";
    expect(
      parseTypecheckLog([line, "Build FAILED.", line].join("\n")),
    ).toHaveLength(1);
  });

  test("Error Prone's repeated summary lines are listed once", () => {
    const line =
      "[ERROR] /w/Greeter.java:[23,5] [NullAway] returning @Nullable expression from method with @NonNull return type";
    expect(parseTypecheckLog(`${line}\n${line}`)).toHaveLength(1);
  });
});

describe("relativeToWorkspace", () => {
  test.each([
    ["/home/runner/work/r/r/src/App.kt:3:5", "src/App.kt:3:5"],
    ["file:///home/runner/work/r/r/src/App.kt", "src/App.kt"],
    ["home/runner/work/r/r/src/App.cs", "src/App.cs"],
    ["src/App.kt", "src/App.kt"],
    ["/elsewhere/App.kt", "/elsewhere/App.kt"],
  ])("%s reads %s", (input, expected) => {
    expect(relativeToWorkspace(input, "/home/runner/work/r/r")).toBe(expected);
  });

  test("an empty workspace leaves the path alone", () => {
    expect(relativeToWorkspace("/a/b.kt", "")).toBe("/a/b.kt");
  });
});

describe("OSV-Scanner", () => {
  test("reads advisories, fixed versions and the scanned package count", () => {
    // osv-scanner.json is OSV-Scanner 2.7.1 output for a Gradle lockfile,
    // trimmed to three packages and two advisories.
    const outcome = parseOsvScanner(read("osv-scanner.json"));
    expect(outcome.status).toBe("vulnerable");
    if (outcome.status !== "vulnerable") return;
    expect(outcome.packagesScanned).toBe(3);
    expect(outcome.total).toBe(2);
    expect(outcome.advisories[0]).toEqual({
      package: "com.fasterxml.jackson.core:jackson-databind",
      version: "2.9.8",
      id: "GHSA-288c-cq4h-88gq",
      fixVersion: "2.9.10.7",
      description:
        "CVSS 7.5 · XML External Entity (XXE) Injection in Jackson Databind",
      url: "https://github.com/advisories/GHSA-288c-cq4h-88gq",
    });
  });

  test("a scan with packages and no advisories is clean", () => {
    const json = JSON.stringify({
      results: [
        {
          packages: [
            { package: { name: "a:b", version: "1.0", ecosystem: "Maven" } },
          ],
        },
      ],
    });
    expect(parseOsvScanner(json)).toEqual({
      status: "clean",
      packagesScanned: 1,
    });
  });

  test("a scan with no packages is indeterminate, not clean", () => {
    expect(parseOsvScanner('{"results": []}').status).toBe("indeterminate");
  });

  test("output that is not OSV-Scanner's is indeterminate", () => {
    expect(parseOsvScanner("not json").status).toBe("indeterminate");
    expect(parseOsvScanner("{}").status).toBe("indeterminate");
  });

  test("compareVersions orders Maven-style versions", () => {
    const sorted = [
      "2.10.5.1",
      "2.9.10.7",
      "2.9.8",
      "2.13.0-rc1",
      "2.13.0",
    ].sort(compareVersions);
    expect(sorted).toEqual([
      "2.9.8",
      "2.9.10.7",
      "2.10.5.1",
      "2.13.0-rc1",
      "2.13.0",
    ]);
  });
});

describe("dotnet package list", () => {
  test("reads advisories and counts every package from the full listing", () => {
    // From the .NET 11 SDK, for a solution referencing Newtonsoft.Json 12.0.1.
    const outcome = parseDotnetPackageList(
      read("dotnet-vulnerable.json"),
      read("dotnet-all.json"),
    );
    expect(outcome.status).toBe("vulnerable");
    if (outcome.status !== "vulnerable") return;
    expect(outcome.total).toBe(1);
    expect(outcome.packagesScanned).toBeGreaterThan(1);
    expect(outcome.advisories[0]).toEqual({
      package: "Newtonsoft.Json",
      version: "12.0.1",
      id: "GHSA-5crp-9r3c-p9vr",
      fixReported: false,
      description: "High severity",
      url: "https://github.com/advisories/GHSA-5crp-9r3c-p9vr",
    });
    expect(formatAuditFindings(outcome)).toContain("| not reported |");
  });

  test("no vulnerable packages is clean", () => {
    const json = JSON.stringify({
      version: 1,
      projects: [{ path: "/w/A.csproj", frameworks: [] }],
    });
    expect(parseDotnetPackageList(json, read("dotnet-all.json")).status).toBe(
      "clean",
    );
  });

  test("an SDK problem is indeterminate", () => {
    const json = JSON.stringify({
      version: 1,
      problems: [{ level: "error", text: "No assets file was found" }],
      projects: [],
    });
    expect(parseDotnetPackageList(json)).toEqual({
      status: "indeterminate",
      reason: "dotnet package list reported: No assets file was found",
    });
  });

  test("output that is not JSON is indeterminate", () => {
    expect(parseDotnetPackageList("oops").status).toBe("indeterminate");
  });
});

describe("readAuditResult", () => {
  test("a missing result file is indeterminate and names the tool", () => {
    expect(readAuditResult("osv-scanner", "/no/such/file.json")).toEqual({
      status: "indeterminate",
      reason: "osv-scanner wrote no result file",
    });
    expect(readAuditResult("dotnet", undefined)).toEqual({
      status: "indeterminate",
      reason: "dotnet package list wrote no result file",
    });
  });

  test("reads each format from a file", () => {
    expect(
      readAuditResult("osv-scanner", resolve(REPORTS, "osv-scanner.json"))
        .status,
    ).toBe("vulnerable");
    expect(
      readAuditResult(
        "dotnet",
        resolve(REPORTS, "dotnet-vulnerable.json"),
        resolve(REPORTS, "dotnet-all.json"),
      ).status,
    ).toBe("vulnerable");
  });
});
