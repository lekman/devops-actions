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
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
// Explicit .js specifiers: the compiled action runs under node's ESM
// resolver, which does not add extensions the way a bundler does.
import { getBoolean, getString, hasTable, parseToml } from "./toml-lite.js";
/** Manifest file to the language it indicates. */
const LANGUAGE_INDICATORS = [
    ["package.json", "node"],
    ["pyproject.toml", "python"],
    ["setup.py", "python"],
];
/** Lockfile to the package manager that writes it. Order is the priority. */
const PM_LOCKFILES = [
    ["poetry.lock", "poetry"],
    ["Pipfile.lock", "pipenv"],
    ["uv.lock", "uv"],
];
/** Lint tool to the pyproject table that configures it. */
const LINT_TABLES = [
    ["ruff", "tool.ruff"],
    ["black", "tool.black"],
    ["flake8", "tool.flake8"],
    ["pylint", "tool.pylint"],
];
/**
 * Probe a repository root and report what it declares.
 *
 * @param root Absolute path to the repository root.
 */
export function detect(root) {
    const languages = [];
    for (const [file, language] of LANGUAGE_INDICATORS) {
        if (existsSync(resolve(root, file)) && !languages.includes(language)) {
            languages.push(language);
        }
    }
    const hasNode = languages.includes("node");
    const hasPython = languages.includes("python");
    return {
        languages,
        hasNode,
        hasPython,
        ...(hasPython ? { python: detectPython(root) } : {}),
    };
}
/**
 * Read the Python side of a repository root.
 *
 * @param root Absolute path to the repository root.
 */
export function detectPython(root) {
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
export function detectPackageManager(root, doc) {
    for (const [file, pm] of PM_LOCKFILES) {
        if (existsSync(resolve(root, file)))
            return pm;
    }
    if (doc) {
        if (hasTable(doc, "tool.poetry"))
            return "poetry";
        if (hasTable(doc, "tool.uv"))
            return "uv";
    }
    if (existsSync(resolve(root, "Pipfile")))
        return "pipenv";
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
export function detectVersion(root, doc) {
    const versionFile = resolve(root, ".python-version");
    if (existsSync(versionFile)) {
        try {
            // The file may list several versions, newest first. mise and pyenv
            // both treat the first line as the one in force.
            const first = readFileSync(versionFile, "utf8").split("\n")[0].trim();
            if (first)
                return first;
        }
        catch {
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
export function normaliseRequiresPython(specifier) {
    for (const clause of specifier.split(",")) {
        const match = clause.trim().match(/^(>=|~=|==|>)?\s*(\d+(?:\.\d+)*)/);
        if (match)
            return match[2];
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
function isBuildable(doc) {
    if (!hasTable(doc, "build-system"))
        return false;
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
function hasTestSetup(root, doc) {
    if (doc && hasTable(doc, "tool.pytest"))
        return true;
    return existsSync(resolve(root, "tests"));
}
function detectLintTools(doc) {
    return LINT_TABLES.filter(([, table]) => hasTable(doc, table)).map(([tool]) => tool);
}
function readPyproject(root) {
    const path = resolve(root, "pyproject.toml");
    if (!existsSync(path))
        return null;
    try {
        return parseToml(readFileSync(path, "utf8"));
    }
    catch {
        return null;
    }
}
// ---- CLI ----
/**
 * Render a detection result as GitHub Actions `key=value` output lines.
 * Python fields are always emitted so a consuming step can read them
 * without first checking `has-python`.
 *
 * @param result Detection result.
 */
export function formatOutputs(result) {
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
    ];
    return `${lines.join("\n")}\n`;
}
/* eslint-disable no-console -- CLI entrypoint, console output is intentional */
function main() {
    const args = new Map();
    for (let i = 2; i < process.argv.length; i += 2) {
        const key = process.argv[i]?.replace(/^--/, "");
        const value = process.argv[i + 1];
        if (key && value !== undefined)
            args.set(key, value);
    }
    const root = resolve(args.get("root") ?? process.cwd());
    const result = detect(root);
    const outputs = formatOutputs(result);
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (githubOutput)
        appendFileSync(githubOutput, outputs);
    if (result.languages.length === 0) {
        console.log(`::notice::language-detect: no package.json, pyproject.toml or setup.py at ${root}`);
    }
    console.log(outputs.trimEnd());
}
if (import.meta.main) {
    main();
}
/* eslint-enable no-console */
//# sourceMappingURL=language-detect.js.map