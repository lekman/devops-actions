/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Detects a JVM project at a directory: which build tool owns it, and
 * which Java version it asks for.
 *
 * Consumed by language-detect, whose outputs gate the jvm-quality and
 * jvm-audit actions.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getString, parseToml } from "./toml-lite.js";

export type JvmBuildTool = "gradle" | "maven";

/** Java version used when the project pins none. */
export const DEFAULT_JAVA_VERSION = "17";

export interface JvmInfo {
  buildTool: JvmBuildTool;
  /** Java feature release, e.g. "21". */
  javaVersion: string;
  /** Where the version came from, e.g. ".java-version", or "default". */
  javaVersionSource: string;
}

const GRADLE_FILES = [
  "settings.gradle.kts",
  "settings.gradle",
  "build.gradle.kts",
  "build.gradle",
];

/**
 * Decide which build tool owns the directory, or null when neither does.
 *
 * Gradle wins when both are present, because a Gradle build that keeps a
 * pom.xml beside it uses it for publishing, not for building.
 *
 * @param root Absolute path to the project directory.
 */
export function detectBuildTool(root: string): JvmBuildTool | null {
  if (GRADLE_FILES.some((f) => existsSync(resolve(root, f)))) return "gradle";
  if (existsSync(resolve(root, "pom.xml"))) return "maven";
  return null;
}

/**
 * Read the JVM side of a directory, or null when it holds no JVM build.
 *
 * @param root Absolute path to the project directory.
 */
export function detectJvm(root: string): JvmInfo | null {
  const buildTool = detectBuildTool(root);
  if (!buildTool) return null;
  const { version, source } = detectJavaVersion(root, buildTool);
  return { buildTool, javaVersion: version, javaVersionSource: source };
}

/**
 * Turn a version as tools write it into a Java feature release.
 *
 * mise and asdf prefix a vendor (`temurin-17.0.21+9`, `corretto-21.0.5`),
 * and Java 8 is often written `1.8`. Only the feature release is kept,
 * because the quality action installs Temurin, and a patch level from
 * another vendor names a build Temurin does not publish.
 *
 * @param raw Version as written in a file.
 * @returns The feature release, or "" when none can be read.
 */
export function normaliseJavaVersion(raw: string): string {
  const trimmed = raw.trim().replace(/^["']|["']$/g, "");
  const match = trimmed.match(/(?:^|[-_])(\d+)(?:\.(\d+))?/);
  if (!match) return "";
  if (match[1] === "1" && match[2]) return match[2];
  return match[1];
}

/**
 * Resolve the Java version, first match wins:
 *
 *   1. `.java-version`
 *   2. a `java` line in `.tool-versions`
 *   3. `[tools] java` in `mise.toml` or `.mise.toml`
 *   4. the Gradle toolchain (`jvmToolchain(21)`, `JavaLanguageVersion.of(21)`)
 *   5. the Maven compiler release (`maven.compiler.release`, `<release>`)
 *   6. {@link DEFAULT_JAVA_VERSION}
 *
 * @param root Absolute path to the project directory.
 * @param buildTool The build tool, which decides where step 4 or 5 looks.
 */
export function detectJavaVersion(
  root: string,
  buildTool: JvmBuildTool,
): { version: string; source: string } {
  const javaVersionFile = readText(root, ".java-version");
  if (javaVersionFile !== null) {
    const v = normaliseJavaVersion(javaVersionFile.split("\n")[0] ?? "");
    if (v) return { version: v, source: ".java-version" };
  }

  const toolVersions = readText(root, ".tool-versions");
  if (toolVersions !== null) {
    for (const line of toolVersions.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === "java" && parts[1]) {
        const v = normaliseJavaVersion(parts[1]);
        if (v) return { version: v, source: ".tool-versions" };
      }
    }
  }

  for (const file of ["mise.toml", ".mise.toml"]) {
    const text = readText(root, file);
    if (text === null) continue;
    try {
      const raw = getString(parseToml(text), "tools.java");
      const v = raw ? normaliseJavaVersion(raw) : "";
      if (v) return { version: v, source: file };
    } catch {
      // An unreadable mise file falls through to the build files.
    }
  }

  if (buildTool === "gradle") {
    for (const file of ["build.gradle.kts", "build.gradle"]) {
      const text = readText(root, file);
      const v = text === null ? "" : gradleToolchainVersion(text);
      if (v) return { version: v, source: file };
    }
  } else {
    const pom = readText(root, "pom.xml");
    const v = pom === null ? "" : mavenReleaseVersion(pom);
    if (v) return { version: v, source: "pom.xml" };
  }

  return { version: DEFAULT_JAVA_VERSION, source: "default" };
}

/**
 * Read the toolchain version from a Gradle build script, Kotlin or Groovy.
 *
 * @param script Build script contents.
 */
export function gradleToolchainVersion(script: string): string {
  const patterns = [
    /jvmToolchain\s*\(\s*(\d+)\s*\)/,
    /JavaLanguageVersion\.of\s*\(\s*["']?(\d+)["']?\s*\)/,
  ];
  for (const pattern of patterns) {
    const m = stripLineComments(script).match(pattern);
    if (m) return m[1];
  }
  return "";
}

/**
 * Read the compiler release from a pom.xml. `maven.compiler.release` is
 * the property Maven documents; `<release>` on the compiler plugin and
 * the older `source`/`target` pair and `java.version` are read after it.
 *
 * @param pom pom.xml contents.
 */
export function mavenReleaseVersion(pom: string): string {
  const text = pom.replace(/<!--[\s\S]*?-->/g, "");
  const tags = [
    "maven.compiler.release",
    "release",
    "maven.compiler.target",
    "maven.compiler.source",
    "java.version",
  ];
  for (const tag of tags) {
    const m = text.match(
      new RegExp(`<${tag.replaceAll(".", "\\.")}>\\s*([^<\\s]+)\\s*</`),
    );
    if (m) {
      const v = normaliseJavaVersion(m[1]);
      if (v) return v;
    }
  }
  return "";
}

function stripLineComments(script: string): string {
  return script
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

function readText(root: string, file: string): string | null {
  const path = resolve(root, file);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
