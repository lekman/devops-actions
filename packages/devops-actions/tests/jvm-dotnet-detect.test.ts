/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  channelOf,
  detectDotnet,
  findGlobalJson,
  readTargetFrameworks,
} from "../src/dotnet-detect";
import { listFiles } from "../src/file-walk";
import {
  DEFAULT_JAVA_VERSION,
  detectBuildTool,
  detectJvm,
  gradleToolchainVersion,
  mavenReleaseVersion,
  normaliseJavaVersion,
} from "../src/jvm-detect";
import { detect, formatOutputs } from "../src/language-detect";

let root: string;

beforeEach(() => {
  root = resolve(
    tmpdir(),
    `jvm-dotnet-detect-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("languages from sources", () => {
  test("Kotlin sources below the root add kotlin", () => {
    write("build.gradle.kts", "");
    write("src/main/kotlin/com/acme/App.kt", "");
    expect(detect(root).languages).toEqual(["kotlin"]);
  });

  test("Java sources add java", () => {
    write("pom.xml", "<project/>");
    write("src/main/java/com/acme/App.java", "");
    expect(detect(root).languages).toEqual(["java"]);
  });

  test("a Kotlin DSL build script alone does not add kotlin", () => {
    write("build.gradle.kts", "");
    write("src/main/java/com/acme/App.java", "");
    expect(detect(root).languages).toEqual(["java"]);
  });

  test("C# sources add csharp", () => {
    write("src/Acme.App/Acme.App.csproj", "<Project/>");
    write("src/Acme.App/Program.cs", "");
    expect(detect(root).languages).toEqual(["csharp"]);
  });

  test("languages keep the documented order in a polyglot repo", () => {
    write("package.json", "{}");
    write("pyproject.toml", "[project]\nname = 'svc'");
    write("svc/src/App.cs", "");
    write("lib/src/main/kotlin/App.kt", "");
    write("lib/src/main/java/App.java", "");
    expect(detect(root).languages).toEqual([
      "node",
      "python",
      "java",
      "kotlin",
      "csharp",
    ]);
  });

  test("sources inside build output do not count", () => {
    write("build/generated/App.kt", "");
    write("target/classes/App.java", "");
    write("src/App/obj/Generated.cs", "");
    write("node_modules/pkg/App.cs", "");
    expect(detect(root).languages).toEqual([]);
  });

  test("sources inside dot folders do not count", () => {
    write(".gradle/cache/App.kt", "");
    expect(detect(root).languages).toEqual([]);
  });
});

describe("file walk", () => {
  test("stops at the depth limit", () => {
    write("a/b/c/deep.kt", "");
    expect(listFiles(root, { maxDepth: 2 })).toEqual([]);
    expect(listFiles(root, { maxDepth: 3 })).toEqual(["a/b/c/deep.kt"]);
  });

  test("stops at the file limit, keeping the shallow files", () => {
    write("top.txt", "");
    write("sub/one.txt", "");
    write("sub/two.txt", "");
    expect(listFiles(root, { maxFiles: 2 })).toEqual([
      "top.txt",
      "sub/one.txt",
    ]);
  });
});

describe("JVM build tool", () => {
  test.each([
    "settings.gradle.kts",
    "settings.gradle",
    "build.gradle.kts",
    "build.gradle",
  ])("%s means gradle", (file) => {
    write(file, "");
    expect(detectBuildTool(root)).toBe("gradle");
  });

  test("pom.xml means maven", () => {
    write("pom.xml", "<project/>");
    expect(detectBuildTool(root)).toBe("maven");
  });

  test("gradle wins when both are present", () => {
    write("pom.xml", "<project/>");
    write("build.gradle.kts", "");
    expect(detectBuildTool(root)).toBe("gradle");
  });

  test("a build file in a subfolder is not the project at this root", () => {
    write("service/build.gradle.kts", "");
    expect(detectBuildTool(root)).toBeNull();
    expect(detect(root).hasJvm).toBe(false);
  });
});

describe("Java version", () => {
  test(".java-version comes first", () => {
    write("build.gradle.kts", "kotlin { jvmToolchain(17) }");
    write(".java-version", "21\n");
    expect(detectJvm(root)).toEqual({
      buildTool: "gradle",
      javaVersion: "21",
      javaVersionSource: ".java-version",
    });
  });

  test(".tool-versions is read when there is no .java-version", () => {
    write("build.gradle.kts", "");
    write(".tool-versions", "nodejs 24.1.0\njava temurin-21.0.5+11\n");
    expect(detectJvm(root)?.javaVersion).toBe("21");
    expect(detectJvm(root)?.javaVersionSource).toBe(".tool-versions");
  });

  test("mise.toml is read next", () => {
    write("build.gradle.kts", "kotlin { jvmToolchain(17) }");
    write("mise.toml", '[tools]\njava = "corretto-25.0.1"\n');
    expect(detectJvm(root)?.javaVersion).toBe("25");
    expect(detectJvm(root)?.javaVersionSource).toBe("mise.toml");
  });

  test(".mise.toml is read too", () => {
    write("build.gradle", "");
    write(".mise.toml", '[tools]\njava = "21"\n');
    expect(detectJvm(root)?.javaVersionSource).toBe(".mise.toml");
  });

  test("a mise version that names no release falls through", () => {
    write("build.gradle.kts", "kotlin { jvmToolchain(21) }");
    write("mise.toml", '[tools]\njava = "latest"\n');
    expect(detectJvm(root)?.javaVersion).toBe("21");
    expect(detectJvm(root)?.javaVersionSource).toBe("build.gradle.kts");
  });

  test("the Gradle toolchain is read from a Groovy build", () => {
    write(
      "build.gradle",
      "java {\n  toolchain {\n    languageVersion = JavaLanguageVersion.of(21)\n  }\n}\n",
    );
    expect(detectJvm(root)?.javaVersion).toBe("21");
    expect(detectJvm(root)?.javaVersionSource).toBe("build.gradle");
  });

  test("the Maven compiler release is read from pom.xml", () => {
    write(
      "pom.xml",
      "<project><properties><maven.compiler.release>21</maven.compiler.release></properties></project>",
    );
    expect(detectJvm(root)).toEqual({
      buildTool: "maven",
      javaVersion: "21",
      javaVersionSource: "pom.xml",
    });
  });

  test("defaults to 17 and says so", () => {
    write("build.gradle.kts", "plugins { java }");
    expect(DEFAULT_JAVA_VERSION).toBe("17");
    expect(detectJvm(root)).toEqual({
      buildTool: "gradle",
      javaVersion: "17",
      javaVersionSource: "default",
    });
  });

  test("no JVM build means no JVM info", () => {
    write(".java-version", "21");
    expect(detectJvm(root)).toBeNull();
  });
});

describe("normaliseJavaVersion", () => {
  test.each([
    ["17", "17"],
    ["21.0.5", "21"],
    ["temurin-17.0.21+9", "17"],
    ["corretto-21.0.5.11.1", "21"],
    ["openjdk-25", "25"],
    ["zulu-21.40", "21"],
    ["1.8", "8"],
    ["temurin-1.8.0", "8"],
    ['"21"', "21"],
    ["latest", ""],
    ["", ""],
  ])("reads %p as %p", (input, expected) => {
    expect(normaliseJavaVersion(input)).toBe(expected);
  });
});

describe("gradleToolchainVersion", () => {
  test.each([
    ["kotlin { jvmToolchain(21) }", "21"],
    ["kotlin { jvmToolchain( 17 ) }", "17"],
    ['languageVersion.set(JavaLanguageVersion.of("21"))', "21"],
    ["languageVersion = JavaLanguageVersion.of(25)", "25"],
    ["// jvmToolchain(11)\nplugins { java }", ""],
    ["plugins { java }", ""],
  ])("reads %p as %p", (script, expected) => {
    expect(gradleToolchainVersion(script)).toBe(expected);
  });
});

describe("mavenReleaseVersion", () => {
  test("prefers maven.compiler.release over source and target", () => {
    const pom = [
      "<maven.compiler.source>11</maven.compiler.source>",
      "<maven.compiler.release>21</maven.compiler.release>",
    ].join("\n");
    expect(mavenReleaseVersion(pom)).toBe("21");
  });

  test("reads the compiler plugin's release", () => {
    expect(
      mavenReleaseVersion(
        "<configuration><release>17</release></configuration>",
      ),
    ).toBe("17");
  });

  test("reads java.version as Spring Boot writes it", () => {
    expect(mavenReleaseVersion("<java.version>21</java.version>")).toBe("21");
  });

  test("skips property references and comments", () => {
    const pom = [
      "<!-- <maven.compiler.release>8</maven.compiler.release> -->",
      "<release>${java.version}</release>",
      "<maven.compiler.target>1.8</maven.compiler.target>",
    ].join("\n");
    expect(mavenReleaseVersion(pom)).toBe("8");
  });

  test("nothing pinned gives an empty string", () => {
    expect(mavenReleaseVersion("<project/>")).toBe("");
  });
});

describe(".NET detection", () => {
  test("a project file below the root means .NET", () => {
    write(
      "src/Acme.App/Acme.App.csproj",
      "<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>",
    );
    const result = detect(root);
    expect(result.hasDotnet).toBe(true);
    expect(result.dotnet?.version).toBe("8.0.x");
    expect(result.dotnet?.versionSource).toBe("TargetFramework");
  });

  test("a solution alone means .NET with no version", () => {
    write("Acme.slnx", "<Solution/>");
    const result = detect(root);
    expect(result.hasDotnet).toBe(true);
    expect(result.dotnet?.version).toBe("");
  });

  test("no project file means no .NET", () => {
    write("global.json", '{"sdk":{"version":"10.0.100"}}');
    expect(detect(root).hasDotnet).toBe(false);
  });

  test("global.json's sdk.version comes first", () => {
    write(
      "global.json",
      '{ "sdk": { "version": "10.0.100", "rollForward": "latestFeature" } }',
    );
    write("App/App.csproj", "<TargetFramework>net9.0</TargetFramework>");
    const info = detectDotnet(root, listFiles(root));
    expect(info?.version).toBe("10.0.100");
    expect(info?.versionSource).toBe("global.json");
  });

  test("global.json may hold comments", () => {
    write(
      "global.json",
      '{\n  // pinned for CI\n  "sdk": { "version": "9.0.300" /* band */ }\n}',
    );
    write("App/App.csproj", "");
    expect(detectDotnet(root, listFiles(root))?.version).toBe("9.0.300");
  });

  test("a global.json that does not parse is ignored", () => {
    write("global.json", "{ not json");
    write("App/App.csproj", "<TargetFramework>net8.0</TargetFramework>");
    expect(detectDotnet(root, listFiles(root))?.version).toBe("8.0.x");
  });

  test("the newest target framework wins across projects and props", () => {
    write(
      "src/A/A.csproj",
      "<TargetFrameworks>net8.0;netstandard2.0</TargetFrameworks>",
    );
    write(
      "tests/A.Tests/A.Tests.fsproj",
      "<TargetFramework>net9.0</TargetFramework>",
    );
    write(
      "Directory.Build.props",
      "<TargetFramework>net10.0</TargetFramework>",
    );
    const info = detectDotnet(root, listFiles(root));
    expect(info?.version).toBe("10.0.x");
    expect(info?.frameworkChannels).toEqual(["8.0.x", "9.0.x", "10.0.x"]);
  });

  test("global.json in a parent folder applies up to the stop folder", () => {
    write("global.json", '{"sdk":{"version":"10.0.100"}}');
    write(
      "services/api/Api.csproj",
      "<TargetFramework>net8.0</TargetFramework>",
    );
    const sub = resolve(root, "services/api");
    expect(detectDotnet(sub, listFiles(sub))?.version).toBe("8.0.x");
    expect(detectDotnet(sub, listFiles(sub), root)?.version).toBe("10.0.100");
  });

  test("findGlobalJson does not climb past the stop folder", () => {
    write("global.json", "{}");
    write("services/api/Api.csproj", "");
    const sub = resolve(root, "services/api");
    expect(findGlobalJson(sub, resolve(root, "services"))).toBe("");
    expect(findGlobalJson(sub, root)).toBe(resolve(root, "global.json"));
  });

  test("test.runner opts in to the Microsoft Testing Platform", () => {
    write("global.json", '{"test":{"runner":"Microsoft.Testing.Platform"}}');
    write("App.Tests/App.Tests.csproj", "");
    expect(detectDotnet(root, listFiles(root))?.testRunner).toBe("mtp");
  });

  test("VSTest is the default test platform", () => {
    write("App.Tests/App.Tests.csproj", "");
    expect(detectDotnet(root, listFiles(root))?.testRunner).toBe("vstest");
  });
});

describe("target frameworks", () => {
  test("reads both singular and plural elements", () => {
    expect(
      readTargetFrameworks(
        "<TargetFramework>net8.0</TargetFramework><TargetFrameworks>net9.0;net10.0-windows</TargetFrameworks>",
      ),
    ).toEqual(["net8.0", "net9.0", "net10.0-windows"]);
  });

  test("skips property references and comments", () => {
    expect(
      readTargetFrameworks(
        "<!-- <TargetFramework>net6.0</TargetFramework> --><TargetFrameworks>$(Frameworks)</TargetFrameworks>",
      ),
    ).toEqual([]);
  });

  test.each([
    ["net8.0", "8.0.x"],
    ["net10.0-windows", "10.0.x"],
    ["netcoreapp3.1", "3.1.x"],
    ["net48", ""],
    ["netstandard2.0", ""],
  ])("maps %p to %p", (tfm, channel) => {
    expect(channelOf(tfm)).toBe(channel);
  });
});

describe("outputs", () => {
  test("a Gradle Kotlin repo", () => {
    write("settings.gradle.kts", "");
    write("build.gradle.kts", "kotlin { jvmToolchain(21) }");
    write("src/main/kotlin/App.kt", "");
    const out = formatOutputs(detect(root));
    expect(out).toContain("languages=kotlin\n");
    expect(out).toContain("has-jvm=true\n");
    expect(out).toContain("jvm-build-tool=gradle\n");
    expect(out).toContain("jvm-version=21\n");
    expect(out).toContain("jvm-version-source=build.gradle.kts\n");
    expect(out).toContain("has-dotnet=false\n");
    expect(out).toContain("dotnet-version=\n");
    expect(out).toContain("dotnet-test-runner=\n");
  });

  test("a .NET repo", () => {
    write(
      "global.json",
      '{"sdk":{"version":"10.0.100"},"test":{"runner":"Microsoft.Testing.Platform"}}',
    );
    write("Acme.slnx", "");
    write("src/App/App.csproj", "");
    write("src/App/Program.cs", "");
    const out = formatOutputs(detect(root));
    expect(out).toContain("languages=csharp\n");
    expect(out).toContain("has-jvm=false\n");
    expect(out).toContain("jvm-build-tool=\n");
    expect(out).toContain("jvm-version=\n");
    expect(out).toContain("has-dotnet=true\n");
    expect(out).toContain("dotnet-version=10.0.100\n");
    expect(out).toContain("dotnet-test-runner=mtp\n");
  });
});
