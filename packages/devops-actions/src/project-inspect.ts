/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Reads a JVM or .NET project's own configuration so the quality actions
 * know which checks the project already runs for itself.
 *
 * The rule is that a repository's own configuration wins. The actions
 * ship defaults (ktlint, detekt, google-java-format, an 80% coverage
 * floor, a C# .editorconfig) for projects that configure none. A project
 * that applies its own plugin for one of those runs it through its build,
 * and the action's default for that check stands down rather than running
 * a second, differently configured copy.
 *
 * Detection reads build files as text, so it recognises the usual ways of
 * applying a plugin (plugin id, version catalog entry, Maven artifact id).
 * A plugin applied some other way, for example from a convention plugin
 * published elsewhere, is not seen. The action then runs its default as
 * well, which can only add a check, never remove one.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  detectDotnet,
  findGlobalJson,
  isProjectFile,
  isSolutionFile,
} from "./dotnet-detect.js";
import { hasExtension, listFiles } from "./file-walk.js";

// ---- JVM ----

export interface JvmProject {
  /** Any .kt or .kts file, so ktlint and detekt have something to read. */
  kotlinSources: boolean;
  /** Any .java file, so google-java-format has something to read. */
  javaSources: boolean;
  /** The build applies ktlint itself (ktlint-gradle, kotlinter, Spotless). */
  ownsKtlint: boolean;
  /** The build applies detekt itself. */
  ownsDetekt: boolean;
  /** The build formats Java itself (Spotless with a Java formatter). */
  ownsJavaFormat: boolean;
  /** The build declares its own coverage rule (Kover bound, JaCoCo rule). */
  ownsCoverageFloor: boolean;
  /**
   * Gradle tasks that run the project's own coverage rule, for the action
   * to name on the command line: koverVerify, jacocoTestCoverageVerification.
   */
  gradleVerifyTasks: string[];
  /** The project's detekt configuration, relative to the root, or "". */
  detektConfig: string;
}

/** Files below a root that hold build configuration, as text. */
function buildTexts(root: string, files: readonly string[]): string {
  const build = files.filter(
    (f) =>
      f.endsWith(".gradle") ||
      f.endsWith(".gradle.kts") ||
      f.endsWith(".versions.toml") ||
      f.endsWith("pom.xml"),
  );
  return build
    .map((f) => {
      try {
        return readFileSync(resolve(root, f), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
}

const DETEKT_CONFIGS = [
  "detekt.yml",
  "detekt.yaml",
  "config/detekt/detekt.yml",
  "config/detekt.yml",
  ".detekt.yml",
];

/**
 * Inspect a JVM project directory.
 *
 * @param root Absolute path to the directory holding the build.
 * @param files Paths below `root`, from listFiles.
 */
export function inspectJvm(root: string, files: readonly string[]): JvmProject {
  const text = buildTexts(root, files);
  const has = (re: RegExp): boolean => re.test(text);

  const ownsKtlint =
    has(/org\.jlleitschuh\.gradle\.ktlint/) ||
    has(/org\.jmailen\.kotlinter/) ||
    has(/ktlint-maven-plugin/) ||
    (has(/spotless/i) && has(/\bktlint\b/));
  const ownsDetekt =
    has(/io\.gitlab\.arturbosch\.detekt/) ||
    has(/["']dev\.detekt["']/) ||
    has(/detekt-maven-plugin/);
  const ownsJavaFormat =
    has(/spotless/i) &&
    has(
      /googleJavaFormat|palantirJavaFormat|eclipse\s*\(|<eclipse>|prettier\s*\(/,
    );

  const koverBound =
    has(/kotlinx\.kover|kover\s*\{/) && has(/minBound\s*\(|bound\s*\{/);
  const jacocoRule =
    has(/jacocoTestCoverageVerification/) && has(/violationRules/);
  const mavenJacocoCheck =
    has(/jacoco-maven-plugin/) && has(/<goal>\s*check\s*<\/goal>/);
  const gradleVerifyTasks = [
    ...(koverBound ? ["koverVerify"] : []),
    ...(jacocoRule ? ["jacocoTestCoverageVerification"] : []),
  ];

  return {
    kotlinSources: hasExtension(files, ".kt", ".kts"),
    javaSources: hasExtension(files, ".java"),
    ownsKtlint,
    ownsDetekt,
    ownsJavaFormat,
    ownsCoverageFloor: koverBound || jacocoRule || mavenJacocoCheck,
    gradleVerifyTasks,
    detektConfig:
      DETEKT_CONFIGS.find((f) => existsSync(resolve(root, f))) ?? "",
  };
}

// ---- .NET ----

export interface DotnetProject {
  /**
   * The solution or project the dotnet commands run against, relative to
   * the root: the one solution at the root, else the one project at the
   * root. "" when there is neither, or more than one, and the action has
   * to build a solution from `projects`.
   */
  target: string;
  /** Every project file below the root, relative to it. */
  projects: string[];
  /** "vstest" or "mtp", from the nearest global.json. */
  testRunner: string;
  /** Absolute path of the nearest global.json, or "" when there is none. */
  globalJson: string;
  /** SDK channels the projects target, for setup-dotnet. */
  frameworkChannels: string[];
  /** An .editorconfig sits at the root or above it, up to the checkout. */
  hasEditorconfig: boolean;
  /** A project sets coverlet's `<Threshold>`. */
  ownsCoverageFloor: boolean;
  /** A project names its own run settings with `RunSettingsFilePath`. */
  ownsRunSettings: boolean;
  /** A test project references coverlet.collector. */
  usesCoverletCollector: boolean;
}

/**
 * Inspect a .NET directory.
 *
 * @param root Absolute path to the directory.
 * @param files Paths below `root`, from listFiles.
 * @param stopAt Highest folder to look in for global.json and .editorconfig.
 */
export function inspectDotnet(
  root: string,
  files: readonly string[],
  stopAt: string = root,
): DotnetProject {
  const atRoot = files.filter((f) => !f.includes("/"));
  const rootSolutions = atRoot.filter(isSolutionFile);
  const rootProjects = atRoot.filter(isProjectFile);
  const target =
    rootSolutions.length === 1
      ? rootSolutions[0]
      : rootSolutions.length === 0 && rootProjects.length === 1
        ? rootProjects[0]
        : "";

  const projects = files.filter(isProjectFile);
  const msbuildFiles = files.filter(
    (f) => isProjectFile(f) || /Directory\.Build\.(props|targets)$/.test(f),
  );
  const text = msbuildFiles
    .map((f) => {
      try {
        return readFileSync(resolve(root, f), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");

  const info = detectDotnet(root, files, stopAt);

  return {
    target,
    projects,
    testRunner: info?.testRunner ?? "vstest",
    globalJson: findGlobalJson(root, stopAt),
    frameworkChannels: info?.frameworkChannels ?? [],
    hasEditorconfig: findUp(root, stopAt, ".editorconfig"),
    ownsCoverageFloor: /<Threshold>\s*\d/.test(text),
    ownsRunSettings: /<RunSettingsFilePath>/.test(text),
    usesCoverletCollector: /Include="coverlet\.collector"/i.test(text),
  };
}

function findUp(root: string, stopAt: string, name: string): boolean {
  const top = resolve(stopAt);
  const inside = !relative(top, resolve(root)).startsWith("..");
  let dir = resolve(root);
  for (;;) {
    if (existsSync(resolve(dir, name))) return true;
    if (!inside || dir === top) return false;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

// ---- CLI ----

/** Render an inspection as GitHub Actions `key=value` output lines. */
export function formatJvmOutputs(p: JvmProject): string {
  return [
    `kotlin-sources=${p.kotlinSources}`,
    `java-sources=${p.javaSources}`,
    `owns-ktlint=${p.ownsKtlint}`,
    `owns-detekt=${p.ownsDetekt}`,
    `owns-java-format=${p.ownsJavaFormat}`,
    `owns-coverage-floor=${p.ownsCoverageFloor}`,
    `gradle-verify-tasks=${p.gradleVerifyTasks.join(" ")}`,
    `detekt-config=${p.detektConfig}`,
    "",
  ].join("\n");
}

/** Render an inspection as GitHub Actions output lines. */
export function formatDotnetOutputs(p: DotnetProject): string {
  return [
    `target=${p.target}`,
    "projects<<PROJECTS_EOF",
    ...p.projects,
    "PROJECTS_EOF",
    `test-runner=${p.testRunner}`,
    `global-json=${p.globalJson}`,
    "framework-channels<<CHANNELS_EOF",
    ...p.frameworkChannels,
    "CHANNELS_EOF",
    `has-editorconfig=${p.hasEditorconfig}`,
    `owns-coverage-floor=${p.ownsCoverageFloor}`,
    `owns-run-settings=${p.ownsRunSettings}`,
    `uses-coverlet-collector=${p.usesCoverletCollector}`,
    "",
  ].join("\n");
}

/* eslint-disable no-console -- CLI entrypoint, console output is intentional */
function main(): void {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--/, "");
    const value = process.argv[i + 1];
    if (key && value !== undefined) args.set(key, value);
  }

  const root = resolve(args.get("root") ?? process.cwd());
  const stopAt = resolve(process.env.GITHUB_WORKSPACE ?? root);
  const kind = args.get("kind");
  const files = listFiles(root);

  let outputs: string;
  if (kind === "jvm") {
    outputs = formatJvmOutputs(inspectJvm(root, files));
  } else if (kind === "dotnet") {
    outputs = formatDotnetOutputs(inspectDotnet(root, files, stopAt));
  } else {
    console.error("project-inspect: --kind must be jvm or dotnet");
    process.exit(1);
  }

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) appendFileSync(githubOutput, outputs);
  console.log(outputs.trimEnd());
}

if (import.meta.main) {
  main();
}
/* eslint-enable no-console */
