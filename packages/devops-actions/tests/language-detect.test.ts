/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  detect,
  detectPython,
  formatOutputs,
  normaliseRequiresPython,
} from "../src/language-detect";

let root: string;

beforeEach(() => {
  root = resolve(
    tmpdir(),
    `language-detect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("detect", () => {
  test("reports node for a package.json repo", () => {
    write("package.json", "{}");
    const result = detect(root);
    expect(result.languages).toEqual(["node"]);
    expect(result.hasNode).toBe(true);
    expect(result.hasPython).toBe(false);
    expect(result.python).toBeUndefined();
  });

  test("reports python for a pyproject.toml repo", () => {
    write("pyproject.toml", "[project]\nname = 'svc'");
    const result = detect(root);
    expect(result.languages).toEqual(["python"]);
    expect(result.hasPython).toBe(true);
    expect(result.python).toBeDefined();
  });

  test("reports python for a setup.py repo with no pyproject", () => {
    write("setup.py", "from setuptools import setup");
    const result = detect(root);
    expect(result.hasPython).toBe(true);
    expect(result.python?.packageManager).toBe("pip");
  });

  test("lists python once when both manifests exist", () => {
    write("pyproject.toml", "[project]\nname = 'svc'");
    write("setup.py", "");
    expect(detect(root).languages).toEqual(["python"]);
  });

  test("reports both languages for a polyglot repo", () => {
    write("package.json", "{}");
    write("pyproject.toml", "[project]\nname = 'svc'");
    const result = detect(root);
    expect(result.languages).toEqual(["node", "python"]);
    expect(result.hasNode).toBe(true);
    expect(result.hasPython).toBe(true);
  });

  test("reports nothing for a repo with no manifest", () => {
    const result = detect(root);
    expect(result.languages).toEqual([]);
    expect(result.hasNode).toBe(false);
    expect(result.hasPython).toBe(false);
  });
});

describe("package manager", () => {
  test("a lockfile decides", () => {
    write("pyproject.toml", "[project]\nname = 'svc'");
    write("poetry.lock", "");
    expect(detectPython(root).packageManager).toBe("poetry");
  });

  test("uv.lock is recognised", () => {
    write("pyproject.toml", "[project]\nname = 'svc'");
    write("uv.lock", "");
    expect(detectPython(root).packageManager).toBe("uv");
  });

  test("Pipfile.lock is recognised", () => {
    write("pyproject.toml", "[project]\nname = 'svc'");
    write("Pipfile.lock", "{}");
    expect(detectPython(root).packageManager).toBe("pipenv");
  });

  test("a lockfile outranks the tool table", () => {
    write("pyproject.toml", "[tool.uv]\ndev-dependencies = []");
    write("poetry.lock", "");
    expect(detectPython(root).packageManager).toBe("poetry");
  });

  test("the tool table decides when no lockfile is committed", () => {
    write("pyproject.toml", "[project]\nname = 'svc'\n\n[tool.poetry]\nname = 'svc'");
    expect(detectPython(root).packageManager).toBe("poetry");
  });

  test("a bare Pipfile means pipenv", () => {
    write("pyproject.toml", "[project]\nname = 'svc'");
    write("Pipfile", "[packages]");
    expect(detectPython(root).packageManager).toBe("pipenv");
  });

  test("falls back to pip", () => {
    write("pyproject.toml", "[project]\nname = 'svc'");
    expect(detectPython(root).packageManager).toBe("pip");
  });
});

describe("interpreter version", () => {
  test("reads .python-version", () => {
    write("pyproject.toml", "[project]\nname = 'svc'");
    write(".python-version", "3.12.7\n");
    expect(detectPython(root).version).toBe("3.12.7");
  });

  test("takes the first line when .python-version lists several", () => {
    write("pyproject.toml", "[project]\nname = 'svc'");
    write(".python-version", "3.12.7\n3.11.9\n");
    expect(detectPython(root).version).toBe("3.12.7");
  });

  test(".python-version outranks requires-python", () => {
    write("pyproject.toml", '[project]\nrequires-python = ">=3.10"');
    write(".python-version", "3.12.7");
    expect(detectPython(root).version).toBe("3.12.7");
  });

  test("falls back to requires-python", () => {
    write("pyproject.toml", '[project]\nrequires-python = ">=3.11"');
    expect(detectPython(root).version).toBe("3.11");
  });

  test("an empty .python-version falls through to requires-python", () => {
    write("pyproject.toml", '[project]\nrequires-python = ">=3.11"');
    write(".python-version", "\n");
    expect(detectPython(root).version).toBe("3.11");
  });

  test("reports no version when the repo pins none", () => {
    write("pyproject.toml", "[project]\nname = 'svc'");
    expect(detectPython(root).version).toBe("");
  });
});

describe("normaliseRequiresPython", () => {
  test.each([
    [">=3.11", "3.11"],
    ["> 3.9", "3.9"],
    ["~=3.12.0", "3.12.0"],
    ["==3.10.4", "3.10.4"],
    ["3.11", "3.11"],
    [">=3.11,<4.0", "3.11"],
  ])("reads %p as %p", (input, expected) => {
    expect(normaliseRequiresPython(input)).toBe(expected);
  });

  test("an upper bound alone names no installable version", () => {
    expect(normaliseRequiresPython("<4.0")).toBe("");
  });

  test("unparseable input yields an empty string", () => {
    expect(normaliseRequiresPython("any")).toBe("");
  });
});

describe("phase flags", () => {
  test("a build-system table means the project builds", () => {
    write(
      "pyproject.toml",
      '[project]\nname = "svc"\n\n[build-system]\nrequires = ["hatchling"]',
    );
    expect(detectPython(root).hasBuild).toBe(true);
  });

  test("poetry package-mode false means it does not build", () => {
    write(
      "pyproject.toml",
      [
        "[build-system]",
        'requires = ["poetry-core"]',
        "",
        "[tool.poetry]",
        "package-mode = false",
      ].join("\n"),
    );
    expect(detectPython(root).hasBuild).toBe(false);
  });

  test("no build-system table means it does not build", () => {
    write("pyproject.toml", '[project]\nname = "svc"');
    expect(detectPython(root).hasBuild).toBe(false);
  });

  test("a pytest table means it tests", () => {
    write("pyproject.toml", '[tool.pytest.ini_options]\ntestpaths = ["tests"]');
    expect(detectPython(root).hasTest).toBe(true);
  });

  test("a bare tests directory means it tests", () => {
    write("pyproject.toml", '[project]\nname = "svc"');
    mkdirSync(resolve(root, "tests"), { recursive: true });
    expect(detectPython(root).hasTest).toBe(true);
  });

  test("neither means it does not test", () => {
    write("pyproject.toml", '[project]\nname = "svc"');
    expect(detectPython(root).hasTest).toBe(false);
  });

  test("a mypy table means it typechecks", () => {
    write("pyproject.toml", "[tool.mypy]\nstrict = true");
    expect(detectPython(root).hasTypecheck).toBe(true);
  });

  test("lint tools come back in run order", () => {
    write(
      "pyproject.toml",
      "[tool.black]\nline-length = 88\n\n[tool.ruff]\nline-length = 88",
    );
    const info = detectPython(root);
    expect(info.hasLint).toBe(true);
    expect(info.lintTools).toEqual(["ruff", "black"]);
  });

  test("flake8 and pylint are recognised", () => {
    write("pyproject.toml", "[tool.pylint]\nmax-line-length = 88");
    expect(detectPython(root).lintTools).toEqual(["pylint"]);
  });

  test("no lint table means no lint phase", () => {
    write("pyproject.toml", '[project]\nname = "svc"');
    const info = detectPython(root);
    expect(info.hasLint).toBe(false);
    expect(info.lintTools).toEqual([]);
  });
});

describe("malformed input", () => {
  test("a pyproject that parses to nothing degrades to skipped phases", () => {
    write("pyproject.toml", "this is not toml at all");
    const info = detectPython(root);
    expect(info.packageManager).toBe("pip");
    expect(info.hasBuild).toBe(false);
    expect(info.hasLint).toBe(false);
    expect(info.hasTypecheck).toBe(false);
  });
});

describe("formatOutputs", () => {
  test("emits every key for a python repo", () => {
    write(
      "pyproject.toml",
      [
        "[project]",
        'requires-python = ">=3.12"',
        "",
        "[build-system]",
        'requires = ["hatchling"]',
        "",
        "[tool.ruff]",
        "line-length = 88",
        "",
        "[tool.mypy]",
        "strict = true",
        "",
        "[tool.pytest.ini_options]",
        'testpaths = ["tests"]',
      ].join("\n"),
    );
    expect(formatOutputs(detect(root))).toBe(
      [
        "languages=python",
        "has-node=false",
        "has-python=true",
        "python-pm=pip",
        "python-version=3.12",
        "python-has-build=true",
        "python-has-test=true",
        "python-has-lint=true",
        "python-has-typecheck=true",
        "python-lint-tools=ruff",
        "",
      ].join("\n"),
    );
  });

  test("emits empty python fields for a node-only repo", () => {
    write("package.json", "{}");
    const out = formatOutputs(detect(root));
    expect(out).toContain("has-python=false");
    expect(out).toContain("python-pm=\n");
    expect(out).toContain("python-has-test=false");
    expect(out).toContain("python-lint-tools=\n");
  });
});
