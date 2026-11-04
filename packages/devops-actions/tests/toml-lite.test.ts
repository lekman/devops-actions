/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */

import { describe, expect, test } from "bun:test";
import {
  getBoolean,
  getString,
  hasTable,
  parseToml,
} from "../src/toml-lite";

const PYPROJECT = `
[project]
name = "example-service"
version = "1.4.0"
requires-python = ">=3.11"
dependencies = [
  "httpx==0.27.0",
  "pydantic==2.7.1",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.ruff]
line-length = 88  # house style

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.mypy]
strict = true
`;

describe("parseToml", () => {
  test("collects tables in document order", () => {
    const doc = parseToml(PYPROJECT);
    expect(doc.tables).toEqual([
      "project",
      "build-system",
      "tool.ruff",
      "tool.pytest.ini_options",
      "tool.mypy",
    ]);
  });

  test("reads scalars under their dotted path", () => {
    const doc = parseToml(PYPROJECT);
    expect(getString(doc, "project.name")).toBe("example-service");
    expect(getString(doc, "project.version")).toBe("1.4.0");
    expect(getString(doc, "project.requires-python")).toBe(">=3.11");
    expect(getString(doc, "build-system.build-backend")).toBe(
      "hatchling.build",
    );
  });

  test("skips arrays rather than reading their first line", () => {
    const doc = parseToml(PYPROJECT);
    expect(getString(doc, "project.dependencies")).toBeUndefined();
    expect(getString(doc, "build-system.requires")).toBeUndefined();
  });

  test("strips trailing comments but keeps a # inside a string", () => {
    const doc = parseToml(
      ['[tool.black]', 'preview = true # opt in', 'colour = "#ff0000"'].join(
        "\n",
      ),
    );
    expect(getBoolean(doc, "tool.black.preview")).toBe(true);
    expect(getString(doc, "tool.black.colour")).toBe("#ff0000");
  });

  test("reads root-level keys under the empty path", () => {
    const doc = parseToml('title = "root"\n\n[project]\nname = "x"');
    expect(getString(doc, "title")).toBe("root");
    expect(getString(doc, "project.name")).toBe("x");
  });

  test("normalises quoted segments in a table header", () => {
    const doc = parseToml('[tool."pytest.ini_options"]\naddopts = "-q"');
    expect(hasTable(doc, "tool.pytest.ini_options")).toBe(true);
    expect(getString(doc, "tool.pytest.ini_options.addopts")).toBe("-q");
  });

  test("registers an array-of-tables header for presence checks", () => {
    const doc = parseToml('[[tool.poetry.packages]]\ninclude = "app"');
    expect(hasTable(doc, "tool.poetry")).toBe(true);
  });

  test("returns empty structures for empty input", () => {
    const doc = parseToml("");
    expect(doc.tables).toEqual([]);
    expect(doc.values).toEqual({});
  });
});

describe("hasTable", () => {
  test("matches an exact path", () => {
    const doc = parseToml("[tool.ruff]\nline-length = 88");
    expect(hasTable(doc, "tool.ruff")).toBe(true);
  });

  test("matches a parent of a nested table", () => {
    const doc = parseToml('[tool.pytest.ini_options]\ntestpaths = ["tests"]');
    expect(hasTable(doc, "tool.pytest")).toBe(true);
  });

  test("does not match a prefix that is not a path segment", () => {
    const doc = parseToml("[tool.ruffian]\nx = 1");
    expect(hasTable(doc, "tool.ruff")).toBe(false);
  });

  test("reports an absent table", () => {
    const doc = parseToml("[tool.ruff]\nline-length = 88");
    expect(hasTable(doc, "tool.mypy")).toBe(false);
  });
});

describe("getBoolean", () => {
  test("distinguishes false from absent", () => {
    const doc = parseToml("[tool.poetry]\npackage-mode = false");
    expect(getBoolean(doc, "tool.poetry.package-mode")).toBe(false);
    expect(getBoolean(doc, "tool.poetry.missing")).toBeUndefined();
  });

  test("treats a non-boolean value as absent", () => {
    const doc = parseToml('[tool.poetry]\npackage-mode = "false"');
    expect(getBoolean(doc, "tool.poetry.package-mode")).toBeUndefined();
  });
});

describe("documented limits", () => {
  test("an inline table is not descended into", () => {
    const doc = parseToml('[tool]\npoetry = { name = "x" }');
    expect(hasTable(doc, "tool.poetry")).toBe(false);
    expect(getString(doc, "tool.poetry.name")).toBeUndefined();
  });

  test("a multi-line array yields no value rather than a partial one", () => {
    const doc = parseToml('[project]\nclassifiers = [\n  "A",\n]');
    expect(getString(doc, "project.classifiers")).toBeUndefined();
  });
});
