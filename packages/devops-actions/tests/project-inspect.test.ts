/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { listFiles } from "../src/file-walk";
import {
  formatDotnetOutputs,
  formatJvmOutputs,
  inspectDotnet,
  inspectJvm,
} from "../src/project-inspect";

let root: string;

beforeEach(() => {
  root = resolve(
    tmpdir(),
    `project-inspect-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(name: string, contents = ""): void {
  const path = resolve(root, name);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

const jvm = () => inspectJvm(root, listFiles(root));
const dotnet = (stopAt = root) => inspectDotnet(root, listFiles(root), stopAt);

describe("inspectJvm", () => {
  test("a plain Kotlin build owns nothing, so every default applies", () => {
    write("build.gradle.kts", 'plugins { kotlin("jvm") version "2.4.21" }');
    write("src/main/kotlin/App.kt");
    expect(jvm()).toEqual({
      kotlinSources: true,
      javaSources: false,
      ownsKtlint: false,
      ownsDetekt: false,
      ownsJavaFormat: false,
      ownsCoverageFloor: false,
      gradleVerifyTasks: [],
      detektConfig: "",
    });
  });

  test("a Kotlin DSL build script counts as Kotlin for ktlint", () => {
    write("build.gradle.kts", "plugins { java }");
    write("src/main/java/App.java");
    expect(jvm().kotlinSources).toBe(true);
    expect(jvm().javaSources).toBe(true);
  });

  test.each([
    ['id("org.jlleitschuh.gradle.ktlint") version "13.0.0"', "ownsKtlint"],
    ['id("org.jmailen.kotlinter")', "ownsKtlint"],
    ["spotless { kotlin { ktlint() } }", "ownsKtlint"],
    ['id("io.gitlab.arturbosch.detekt") version "1.23.8"', "ownsDetekt"],
    ['id("dev.detekt") version "2.0.0"', "ownsDetekt"],
    ["spotless { java { googleJavaFormat() } }", "ownsJavaFormat"],
    ["spotless { java { palantirJavaFormat() } }", "ownsJavaFormat"],
  ])("%s means %s", (script, key) => {
    write("build.gradle.kts", script);
    expect(jvm()[key as "ownsKtlint"]).toBe(true);
  });

  test("Spotless for Java alone does not own ktlint", () => {
    write("build.gradle.kts", "spotless { java { googleJavaFormat() } }");
    expect(jvm().ownsKtlint).toBe(false);
  });

  test("a plugin in the version catalog is seen", () => {
    write("build.gradle.kts", "plugins { alias(libs.plugins.detekt) }");
    write(
      "gradle/libs.versions.toml",
      '[plugins]\ndetekt = { id = "io.gitlab.arturbosch.detekt", version = "1.23.8" }',
    );
    expect(jvm().ownsDetekt).toBe(true);
  });

  test("a plugin in a module build file is seen", () => {
    write("settings.gradle.kts", 'include(":app")');
    write(
      "app/build.gradle.kts",
      'plugins { id("org.jlleitschuh.gradle.ktlint") }',
    );
    expect(jvm().ownsKtlint).toBe(true);
  });

  test("a Kover bound owns the coverage floor and names koverVerify", () => {
    write(
      "build.gradle.kts",
      'plugins { id("org.jetbrains.kotlinx.kover") }\nkover { reports { verify { rule { minBound(70) } } } }',
    );
    expect(jvm().ownsCoverageFloor).toBe(true);
    expect(jvm().gradleVerifyTasks).toEqual(["koverVerify"]);
  });

  test("Kover without a bound leaves the floor to the action", () => {
    write("build.gradle.kts", 'plugins { id("org.jetbrains.kotlinx.kover") }');
    expect(jvm().ownsCoverageFloor).toBe(false);
  });

  test("a JaCoCo violation rule owns the floor and names its task", () => {
    write(
      "build.gradle",
      "jacocoTestCoverageVerification { violationRules { rule { limit { minimum = 0.9 } } } }",
    );
    expect(jvm().ownsCoverageFloor).toBe(true);
    expect(jvm().gradleVerifyTasks).toEqual(["jacocoTestCoverageVerification"]);
  });

  test("the JaCoCo Maven plugin's check goal owns the floor", () => {
    write(
      "pom.xml",
      "<plugin><artifactId>jacoco-maven-plugin</artifactId><executions><execution><goals><goal>check</goal></goals></execution></executions></plugin>",
    );
    expect(jvm().ownsCoverageFloor).toBe(true);
    expect(jvm().gradleVerifyTasks).toEqual([]);
  });

  test("the first detekt configuration found is used", () => {
    write("build.gradle.kts");
    write("config/detekt/detekt.yml", "build:\n  maxIssues: 0");
    expect(jvm().detektConfig).toBe("config/detekt/detekt.yml");
  });

  test("outputs are written as key=value lines", () => {
    write("pom.xml", "<project/>");
    write("src/main/java/App.java");
    expect(formatJvmOutputs(jvm())).toBe(
      [
        "kotlin-sources=false",
        "java-sources=true",
        "owns-ktlint=false",
        "owns-detekt=false",
        "owns-java-format=false",
        "owns-coverage-floor=false",
        "gradle-verify-tasks=",
        "detekt-config=",
        "",
      ].join("\n"),
    );
  });
});

describe("inspectDotnet", () => {
  test("the one solution at the root is the target", () => {
    write("Acme.slnx");
    write("src/A/A.csproj", "<TargetFramework>net10.0</TargetFramework>");
    write(
      "tests/A.Tests/A.Tests.csproj",
      "<TargetFramework>net10.0</TargetFramework>",
    );
    const p = dotnet();
    expect(p.target).toBe("Acme.slnx");
    expect(p.projects).toEqual([
      "src/A/A.csproj",
      "tests/A.Tests/A.Tests.csproj",
    ]);
    expect(p.frameworkChannels).toEqual(["10.0.x"]);
  });

  test("the one project at the root is the target when there is no solution", () => {
    write("A.csproj");
    expect(dotnet().target).toBe("A.csproj");
  });

  test("no target when there are several solutions or none at the root", () => {
    write("One.sln");
    write("Two.sln");
    expect(dotnet().target).toBe("");
  });

  test("no target when projects sit only in subfolders", () => {
    write("src/A/A.csproj");
    write("src/B/B.csproj");
    expect(dotnet().target).toBe("");
    expect(dotnet().projects).toHaveLength(2);
  });

  test("global.json decides the test platform and is located", () => {
    write("global.json", '{"test":{"runner":"Microsoft.Testing.Platform"}}');
    write("A.Tests/A.Tests.csproj");
    expect(dotnet().testRunner).toBe("mtp");
    expect(dotnet().globalJson).toBe(resolve(root, "global.json"));
  });

  test("no global.json means VSTest and an empty path", () => {
    write("A.Tests/A.Tests.csproj");
    expect(dotnet().testRunner).toBe("vstest");
    expect(dotnet().globalJson).toBe("");
  });

  test("an .editorconfig above the project counts, up to the stop folder", () => {
    write(".editorconfig", "root = true");
    write("svc/A.csproj");
    const sub = resolve(root, "svc");
    expect(inspectDotnet(sub, listFiles(sub), sub).hasEditorconfig).toBe(false);
    expect(inspectDotnet(sub, listFiles(sub), root).hasEditorconfig).toBe(true);
  });

  test("coverlet's Threshold owns the floor", () => {
    write(
      "A.Tests/A.Tests.csproj",
      "<PropertyGroup><Threshold>90</Threshold></PropertyGroup>",
    );
    expect(dotnet().ownsCoverageFloor).toBe(true);
  });

  test("a Threshold in Directory.Build.props counts too", () => {
    write("A.Tests/A.Tests.csproj");
    write("Directory.Build.props", "<Threshold>75</Threshold>");
    expect(dotnet().ownsCoverageFloor).toBe(true);
  });

  test("run settings and coverlet.collector are noticed", () => {
    write(
      "A.Tests/A.Tests.csproj",
      '<RunSettingsFilePath>ci.runsettings</RunSettingsFilePath><PackageReference Include="coverlet.collector" Version="6.0.4" />',
    );
    const p = dotnet();
    expect(p.ownsRunSettings).toBe(true);
    expect(p.usesCoverletCollector).toBe(true);
  });

  test("outputs list the projects and channels as multi-line values", () => {
    write(
      "src/A/A.csproj",
      "<TargetFrameworks>net8.0;net10.0</TargetFrameworks>",
    );
    expect(formatDotnetOutputs(dotnet())).toBe(
      [
        "target=",
        "projects<<PROJECTS_EOF",
        "src/A/A.csproj",
        "PROJECTS_EOF",
        "test-runner=vstest",
        "global-json=",
        "framework-channels<<CHANNELS_EOF",
        "8.0.x",
        "10.0.x",
        "CHANNELS_EOF",
        "has-editorconfig=false",
        "owns-coverage-floor=false",
        "owns-run-settings=false",
        "uses-coverlet-collector=false",
        "",
      ].join("\n"),
    );
  });
});
