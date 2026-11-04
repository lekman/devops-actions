/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Detects which languages a repository declares, and for Python which
 * package manager owns it, which interpreter version it pins, and which
 * CI phases its `pyproject.toml` actually configures.
 *
 * Consumed by the `detect-language` composite action, whose outputs gate
 * the per-language steps in the `quality` job of `ci.yml`.
 *
 * It reads one repository root, not a matrix of discovered projects.
 */
import type { TomlDocument } from "./toml-lite.js";
export type Language = "node" | "python";
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
}
/**
 * Probe a repository root and report what it declares.
 *
 * @param root Absolute path to the repository root.
 */
export declare function detect(root: string): DetectionResult;
/**
 * Read the Python side of a repository root.
 *
 * @param root Absolute path to the repository root.
 */
export declare function detectPython(root: string): PythonInfo;
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
export declare function detectPackageManager(root: string, doc: TomlDocument | null): PythonPackageManager;
/**
 * Resolve the interpreter version from `.python-version`, falling back to
 * pyproject's `requires-python` with its specifier characters stripped
 * (`>=3.11` reads as `3.11`). Returns "" when the repo pins neither.
 *
 * @param root Absolute path to the repository root.
 * @param doc Parsed `pyproject.toml`, or null when absent.
 */
export declare function detectVersion(root: string, doc: TomlDocument | null): string;
/**
 * Turn a `requires-python` specifier into a bare version mise can install.
 * Only the first constraint is read, and an upper bound on its own
 * (`<4.0`) names no installable version so it yields "".
 *
 * @param specifier Raw `requires-python` value.
 */
export declare function normaliseRequiresPython(specifier: string): string;
/**
 * Render a detection result as GitHub Actions `key=value` output lines.
 * Python fields are always emitted so a consuming step can read them
 * without first checking `has-python`.
 *
 * @param result Detection result.
 */
export declare function formatOutputs(result: DetectionResult): string;
