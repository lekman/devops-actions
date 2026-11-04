/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildReleaseMatrix, parseNameFromTag } from "../src/release-matrix";

const CONFIG = JSON.stringify({
  packages: {
    "packages/foo": { "release-type": "node", "package-name": "@org/foo" },
    "packages/bar": { "release-type": "node", "package-name": "@org/bar" },
  },
});

let repoRoot: string;

beforeEach(() => {
  repoRoot = resolve(
    tmpdir(),
    `release-matrix-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(repoRoot, { recursive: true });
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function writePackage(
  path: string,
  json: Record<string, unknown>,
  extras: Record<string, string> = {},
): void {
  const full = resolve(repoRoot, path);
  mkdirSync(full, { recursive: true });
  writeFileSync(resolve(full, "package.json"), JSON.stringify(json));
  for (const [name, contents] of Object.entries(extras)) {
    writeFileSync(resolve(full, name), contents);
  }
}

describe("buildReleaseMatrix", () => {
  test("returns empty when releases_created is false", () => {
    const m = buildReleaseMatrix({
      releaseOutputs: { releases_created: "false" },
      configContents: CONFIG,
      repoRoot,
    });
    expect(m.releasesCreated).toBe(false);
    expect(m.entries).toHaveLength(0);
  });

  test("emits an entry per released path with metadata", () => {
    writePackage("packages/foo", {
      name: "@org/foo",
      scripts: { build: "tsc" },
      publishConfig: { registry: "https://npm.pkg.github.com" },
    });
    writePackage("packages/bar", {
      name: "@org/bar",
      private: true,
    });

    const m = buildReleaseMatrix({
      releaseOutputs: {
        releases_created: "true",
        "packages/foo--release_created": "true",
        "packages/foo--tag_name": "packages/foo-v1.2.3",
        "packages/foo--version": "1.2.3",
        "packages/bar--release_created": "true",
        "packages/bar--tag_name": "packages/bar-v0.5.0",
        "packages/bar--version": "0.5.0",
      },
      configContents: CONFIG,
      repoRoot,
    });

    expect(m.releasesCreated).toBe(true);
    expect(m.entries).toHaveLength(2);

    const foo = m.entries.find((e) => e.path === "packages/foo")!;
    expect(foo.name).toBe("packages/foo");
    expect(foo.tag).toBe("packages/foo-v1.2.3");
    expect(foo.version).toBe("1.2.3");
    expect(foo.releaseType).toBe("node");
    expect(foo.language).toBe("node");
    expect(foo.publishable).toBe(true);
    expect(foo.hasBuild).toBe(true);
    expect(foo.registry).toBe("https://npm.pkg.github.com");

    const bar = m.entries.find((e) => e.path === "packages/bar")!;
    expect(bar.publishable).toBe(false); // private
    expect(bar.hasBuild).toBe(false);
    expect(bar.registry).toBeUndefined();
  });

  test("ignores paths where --release_created is false", () => {
    writePackage("packages/foo", { name: "@org/foo" });
    const m = buildReleaseMatrix({
      releaseOutputs: {
        releases_created: "true",
        "packages/foo--release_created": "false",
        "packages/foo--tag_name": "packages/foo-v1.0.0",
      },
      configContents: CONFIG,
      repoRoot,
    });
    expect(m.entries).toHaveLength(0);
  });

  test("reports drift when a released path is absent from config", () => {
    writePackage("packages/ghost", { name: "@org/ghost" });
    const m = buildReleaseMatrix({
      releaseOutputs: {
        releases_created: "true",
        "packages/ghost--release_created": "true",
        "packages/ghost--tag_name": "packages/ghost-v0.1.0",
        "packages/ghost--version": "0.1.0",
      },
      configContents: CONFIG,
      repoRoot,
    });
    expect(m.drift).toEqual(["packages/ghost"]);
    expect(m.entries).toHaveLength(1);
  });

  test("sorts entries by path for deterministic matrix order", () => {
    writePackage("packages/foo", { name: "@org/foo" });
    writePackage("packages/bar", { name: "@org/bar" });
    const m = buildReleaseMatrix({
      releaseOutputs: {
        releases_created: "true",
        "packages/foo--release_created": "true",
        "packages/foo--tag_name": "packages/foo-v1.0.0",
        "packages/bar--release_created": "true",
        "packages/bar--tag_name": "packages/bar-v1.0.0",
      },
      configContents: CONFIG,
      repoRoot,
    });
    expect(m.entries.map((e) => e.path)).toEqual([
      "packages/bar",
      "packages/foo",
    ]);
  });

  test("detects docker, python, helm, kotlin, powershell languages", () => {
    // docker only (no package.json)
    mkdirSync(resolve(repoRoot, "apps/api"), { recursive: true });
    writeFileSync(resolve(repoRoot, "apps/api/Dockerfile"), "FROM scratch");
    // python
    mkdirSync(resolve(repoRoot, "apps/py"), { recursive: true });
    writeFileSync(resolve(repoRoot, "apps/py/pyproject.toml"), "[project]");
    // helm
    mkdirSync(resolve(repoRoot, "charts/web"), { recursive: true });
    writeFileSync(resolve(repoRoot, "charts/web/Chart.yaml"), "name: web");
    // kotlin
    mkdirSync(resolve(repoRoot, "svc/kt"), { recursive: true });
    writeFileSync(resolve(repoRoot, "svc/kt/Main.kt"), "fun main(){}");
    // powershell
    mkdirSync(resolve(repoRoot, "mod/ps"), { recursive: true });
    writeFileSync(resolve(repoRoot, "mod/ps/Module.psd1"), "@{}");

    const m = buildReleaseMatrix({
      releaseOutputs: {
        releases_created: "true",
        "apps/api--release_created": "true",
        "apps/api--tag_name": "apps/api-v1.0.0",
        "apps/py--release_created": "true",
        "apps/py--tag_name": "apps/py-v1.0.0",
        "charts/web--release_created": "true",
        "charts/web--tag_name": "charts/web-v1.0.0",
        "svc/kt--release_created": "true",
        "svc/kt--tag_name": "svc/kt-v1.0.0",
        "mod/ps--release_created": "true",
        "mod/ps--tag_name": "mod/ps-v1.0.0",
      },
      configContents: JSON.stringify({
        packages: {
          "apps/api": {},
          "apps/py": {},
          "charts/web": {},
          "svc/kt": {},
          "mod/ps": {},
        },
      }),
      repoRoot,
    });

    const byPath = Object.fromEntries(
      m.entries.map((e) => [e.path, e.language]),
    );
    expect(byPath["apps/api"]).toBe("docker");
    expect(byPath["apps/py"]).toBe("python");
    expect(byPath["charts/web"]).toBe("helm");
    expect(byPath["svc/kt"]).toBe("kotlin");
    expect(byPath["mod/ps"]).toBe("powershell");
  });

  test("falls back to top-level release-type when per-package is absent", () => {
    writePackage("packages/foo", { name: "@org/foo" });
    const m = buildReleaseMatrix({
      releaseOutputs: {
        releases_created: "true",
        "packages/foo--release_created": "true",
        "packages/foo--tag_name": "packages/foo-v1.0.0",
      },
      configContents: JSON.stringify({
        "release-type": "node",
        packages: { "packages/foo": {} },
      }),
      repoRoot,
    });
    expect(m.entries[0].releaseType).toBe("node");
  });

  test("non-node packages are never publishable", () => {
    mkdirSync(resolve(repoRoot, "apps/svc"), { recursive: true });
    writeFileSync(resolve(repoRoot, "apps/svc/Dockerfile"), "FROM scratch");
    const m = buildReleaseMatrix({
      releaseOutputs: {
        releases_created: "true",
        "apps/svc--release_created": "true",
        "apps/svc--tag_name": "apps/svc-v1.0.0",
      },
      configContents: JSON.stringify({
        packages: { "apps/svc": { "release-type": "simple" } },
      }),
      repoRoot,
    });
    expect(m.entries[0].language).toBe("docker");
    expect(m.entries[0].publishable).toBe(false);
  });
});

describe("parseNameFromTag", () => {
  test("handles dash separator", () => {
    expect(parseNameFromTag("packages/foo-v1.2.3", "packages/foo")).toBe(
      "packages/foo",
    );
  });

  test("handles at separator", () => {
    expect(parseNameFromTag("@org/foo@v2.0.0-alpha", "packages/foo")).toBe(
      "@org/foo",
    );
  });

  test("falls back to path segment when tag is unrecognized", () => {
    expect(parseNameFromTag("", "packages/foo")).toBe("foo");
  });
});
