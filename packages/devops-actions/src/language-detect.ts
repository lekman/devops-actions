/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Detects which languages a repository declares, and for Python which
 * package manager owns it, which interpreter version it pins, and which
 * CI phases its `pyproject.toml` actually configures. For the JVM it
 * reports the build tool and Java version, for .NET the SDK version, and
 * for Rust the toolchain the repository pins.
 *
 * Consumed by the `detect-language` composite action, whose outputs gate
 * the per-language steps in the `quality` job of `ci.yml`.
 *
 * It reads one repository root, not a matrix of discovered projects.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
// Explicit .js specifiers: the compiled action runs under node's ESM
// resolver, which does not add extensions the way a bundler does.
import { detectDotnet } from "./dotnet-detect.js";
import { hasExtension, listFiles } from "./file-walk.js";
import { detectJvm } from "./jvm-detect.js";
import { detectRust } from "./rust-detect.js";
import { getBoolean, getString, hasTable, parseToml } from "./toml-lite.js";
import type { DotnetInfo } from "./dotnet-detect.js";
import type { JvmInfo } from "./jvm-detect.js";
import type { RustInfo } from "./rust-detect.js";
import type { TomlDocument } from "./toml-lite.js";

export type Language =
  "node" | "python" | "rust" | "java" | "kotlin" | "csharp";

export type PythonPackageManager = "pip" | "pipenv" | "poetry" | "uv";

export type PythonLintTool = "black" | "flake8" | "pylint" | "ruff";

export interface PythonInfo {
  packageManager: PythonPackageManager;
  /** Interpreter version, or "" when the repo pins none. */
  version: string;
  hasBuild: boolean;
  hasTest: boolean;
  hasLint: boolean;
  hasTypecheck: boolean;
  /** Configured lint tools, in the order they are run. */
  lintTools: PythonLintTool[];
}

export interface DetectionResult {
  languages: Language[];
  hasNode: boolean;
  hasPython: boolean;
  /** Present only when `hasPython` is true. */
  python?: PythonInfo;
  /** True when the directory holds a Gradle or Maven build. */
  hasJvm: boolean;
  /** Present only when `hasJvm` is true. */
  jvm?: JvmInfo;
  /** True when a solution or .NET project file sits at or below the root. */
  hasDotnet: boolean;
  /** Present only when `hasDotnet` is true. */
  dotnet?: DotnetInfo;
  /** True when the directory holds a Cargo.toml, a package or a workspace. */
  hasRust: boolean;
  /** Present only when `hasRust` is true. */
  rust?: RustInfo;
}

/** Source extension to the language it indicates, in `languages` order. */
const SOURCE_LANGUAGES: ReadonlyArray<[string, Language]> = [
  [".java", "java"],
  // Only .kt: a Java project with a Kotlin DSL build script (.kts) is not
  // a Kotlin project, and Semgrep's Kotlin rules have nothing to say about
  // build scripts.
  [".kt", "kotlin"],
  [".cs", "csharp"],
];

/** Manifest file to the language it indicates. */
const LANGUAGE_INDICATORS: ReadonlyArray<[string, Language]> = [
  ["package.json", "node"],
  ["pyproject.toml", "python"],
  ["setup.py", "python"],
  ["Cargo.toml", "rust"],
];

/** Lockfile to the package manager that writes it. Order is the priority. */
const PM_LOCKFILES: ReadonlyArray<[string, PythonPackageManager]> = [
  ["poetry.lock", "poetry"],
  ["Pipfile.lock", "pipenv"],
  ["uv.lock", "uv"],
];

/** Lint tool to the pyproject table that configures it. */
const LINT_TABLES: ReadonlyArray<[PythonLintTool, string]> = [
  ["ruff", "tool.ruff"],
  ["black", "tool.black"],
  ["flake8", "tool.flake8"],
  ["pylint", "tool.pylint"],
];

/**
 * Probe a repository root and report what it declares.
 *
 * Node, Python and Rust are read from manifests at the root. JVM and .NET
 * sources and project files usually sit below it, so those are found by a
 * bounded walk of the tree (see file-walk).
 *
 * @param root Absolute path to the repository root.
 * @param stopAt Highest folder to look in for a .NET global.json or a Rust
 *   toolchain file, usually the repository root when `root` is a
 *   subfolder. Defaults to `root`.
 */
export function detect(root: string, stopAt: string = root): DetectionResult {
  const languages: Language[] = [];
  for (const [file, language] of LANGUAGE_INDICATORS) {
    if (existsSync(resolve(root, file)) && !languages.includes(language)) {
      languages.push(language);
    }
  }

  const files = listFiles(root);
  for (const [extension, language] of SOURCE_LANGUAGES) {
    if (hasExtension(files, extension)) languages.push(language);
  }

  const hasNode = languages.includes("node");
  const hasPython = languages.includes("python");
  const jvm = detectJvm(root);
  const dotnet = detectDotnet(root, files, stopAt);
  const rust = detectRust(root, stopAt);

  return {
    languages,
    hasNode,
    hasPython,
    ...(hasPython ? { python: detectPython(root) } : {}),
    hasJvm: jvm !== null,
    ...(jvm ? { jvm } : {}),
    hasDotnet: dotnet !== null,
    ...(dotnet ? { dotnet } : {}),
    hasRust: rust !== null,
    ...(rust ? { rust } : {}),
  };
}

/**
 * Read the Python side of a repository root.
 *
 * @param root Absolute path to the repository root.
 */
export function detectPython(root: string): PythonInfo {
  const doc = readPyproject(root);
  const lintTools = doc ? detectLintTools(doc) : [];

  return {
    packageManager: detectPackageManager(root, doc),
    version: detectVersion(root, doc),
    hasBuild: doc !== null && isBuildable(doc),
    hasTest: hasTestSetup(root, doc),
    hasLint: lintTools.length > 0,
    hasTypecheck: doc !== null && hasTable(doc, "tool.mypy"),
    lintTools,
  };
}

/**
 * Decide which package manager owns the project.
 *
 * Lockfile presence is the strongest signal. Teams that do not commit a
 * lockfile still want their poetry or uv project recognised, so the
 * `[tool.*]` tables are the second signal — without that fallback, a
 * poetry project gets `pip install -e ".[dev]"` run against it, which
 * fails on `package-mode = false` roots and on any layout pip cannot
 * build.
 *
 * @param root Absolute path to the repository root.
 * @param doc Parsed `pyproject.toml`, or null when absent.
 */
export function detectPackageManager(
  root: string,
  doc: TomlDocument | null,
): PythonPackageManager {
  for (const [file, pm] of PM_LOCKFILES) {
    if (existsSync(resolve(root, file))) return pm;
  }
  if (doc) {
    if (hasTable(doc, "tool.poetry")) return "poetry";
    if (hasTable(doc, "tool.uv")) return "uv";
  }
  if (existsSync(resolve(root, "Pipfile"))) return "pipenv";
  return "pip";
}

/**
 * Resolve the interpreter version from `.python-version`, falling back to
 * pyproject's `requires-python` with its specifier characters stripped
 * (`>=3.11` reads as `3.11`). Returns "" when the repo pins neither.
 *
 * @param root Absolute path to the repository root.
 * @param doc Parsed `pyproject.toml`, or null when absent.
 */
export function detectVersion(root: string, doc: TomlDocument | null): string {
  const versionFile = resolve(root, ".python-version");
  if (existsSync(versionFile)) {
    try {
      // The file may list several versions, newest first. mise and pyenv
      // both treat the first line as the one in force.
      const first = readFileSync(versionFile, "utf8").split("\n")[0].trim();
      if (first) return first;
    } catch {
      // Unreadable file falls through to requires-python.
    }
  }

  const requires = doc ? getString(doc, "project.requires-python") : undefined;
  return requires ? normaliseRequiresPython(requires) : "";
}

/**
 * Turn a `requires-python` specifier into a bare version mise can install.
 * Only the first constraint is read, and an upper bound on its own
 * (`<4.0`) names no installable version so it yields "".
 *
 * @param specifier Raw `requires-python` value.
 */
export function normaliseRequiresPython(specifier: string): string {
  for (const clause of specifier.split(",")) {
    const match = clause.trim().match(/^(>=|~=|==|>)?\s*(\d+(?:\.\d+)*)/);
    if (match) return match[2];
  }
  return "";
}

/**
 * A `[build-system]` table is the PEP 517 marker that the project produces
 * a wheel or sdist. Poetry sets `package-mode = false` on workspaces that
 * exist only to hold dependencies (migration scripts, ops tooling); those
 * build nothing.
 *
 * @param doc Parsed `pyproject.toml`.
 */
function isBuildable(doc: TomlDocument): boolean {
  if (!hasTable(doc, "build-system")) return false;
  return getBoolean(doc, "tool.poetry.package-mode") !== false;
}

/**
 * A configured pytest table names the test phase outright. A bare `tests/`
 * directory is the common case for projects that keep pytest on its
 * defaults and configure nothing.
 *
 * @param root Absolute path to the repository root.
 * @param doc Parsed `pyproject.toml`, or null when absent.
 */
function hasTestSetup(root: string, doc: TomlDocument | null): boolean {
  if (doc && hasTable(doc, "tool.pytest")) return true;
  return existsSync(resolve(root, "tests"));
}

function detectLintTools(doc: TomlDocument): PythonLintTool[] {
  return LINT_TABLES.filter(([, table]) => hasTable(doc, table)).map(
    ([tool]) => tool,
  );
}

function readPyproject(root: string): TomlDocument | null {
  const path = resolve(root, "pyproject.toml");
  if (!existsSync(path)) return null;
  try {
    return parseToml(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// ---- CLI ----

/**
 * Render a detection result as GitHub Actions `key=value` output lines.
 * Every field is always emitted so a consuming step can read it without
 * first checking `has-python`, `has-jvm`, `has-dotnet` or `has-rust`.
 *
 * @param result Detection result.
 */
export function formatOutputs(result: DetectionResult): string {
  const py = result.python;
  const lines = [
    `languages=${result.languages.join(",")}`,
    `has-node=${result.hasNode}`,
    `has-python=${result.hasPython}`,
    `python-pm=${py?.packageManager ?? ""}`,
    `python-version=${py?.version ?? ""}`,
    `python-has-build=${py?.hasBuild ?? false}`,
    `python-has-test=${py?.hasTest ?? false}`,
    `python-has-lint=${py?.hasLint ?? false}`,
    `python-has-typecheck=${py?.hasTypecheck ?? false}`,
    `python-lint-tools=${py?.lintTools.join(",") ?? ""}`,
    `has-jvm=${result.hasJvm}`,
    `jvm-build-tool=${result.jvm?.buildTool ?? ""}`,
    `jvm-version=${result.jvm?.javaVersion ?? ""}`,
    `jvm-version-source=${result.jvm?.javaVersionSource ?? ""}`,
    `has-dotnet=${result.hasDotnet}`,
    `dotnet-version=${result.dotnet?.version ?? ""}`,
    `dotnet-test-runner=${result.dotnet?.testRunner ?? ""}`,
    `has-rust=${result.hasRust}`,
    `rust-workspace=${result.rust?.workspace ?? false}`,
    `rust-has-lockfile=${result.rust?.hasLockfile ?? false}`,
    `rust-toolchain=${result.rust?.toolchain ?? ""}`,
    `rust-toolchain-source=${result.rust?.toolchainSource ?? ""}`,
    `rust-toolchain-file=${result.rust?.toolchainFile ?? ""}`,
  ];
  return `${lines.join("\n")}\n`;
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
  // The SDK reads a global.json above the project too, and rustup and mise
  // read a toolchain file above it, so look up to the checkout root when
  // the action runs in a subfolder.
  const stopAt = resolve(process.env.GITHUB_WORKSPACE ?? root);
  const result = detect(root, stopAt);
  const outputs = formatOutputs(result);

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) appendFileSync(githubOutput, outputs);

  if (result.languages.length === 0 && !result.hasJvm && !result.hasDotnet) {
    console.log(
      `::notice::language-detect: no package.json, pyproject.toml, setup.py, Cargo.toml, JVM build, .NET project or Java, Kotlin or C# source at ${root}`,
    );
  }
  if (result.rust && result.rust.toolchainSource === "") {
    console.log(
      `::warning::language-detect: Cargo.toml at ${root} but no pinned Rust toolchain. Add rust-toolchain.toml, or rust under [tools] in mise.toml.`,
    );
  }
  console.log(outputs.trimEnd());
}

if (import.meta.main) {
  main();
}
/* eslint-enable no-console */
