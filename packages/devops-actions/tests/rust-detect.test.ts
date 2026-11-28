/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { detect, formatOutputs } from "../src/language-detect";
import { detectRust, readMisePin, readRustupPin } from "../src/rust-detect";

let root: string;

beforeEach(() => {
  root = resolve(
    tmpdir(),
    `rust-detect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

const WORKSPACE = '[workspace]\nmembers = ["crates/*"]\nresolver = "3"\n';
const PACKAGE =
  '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2024"\n';
const TOOLCHAIN =
  '[toolchain]\nchannel = "1.100.0"\ncomponents = ["rustfmt", "clippy"]\n';

describe("detectRust", () => {
  test("returns null without a Cargo.toml", () => {
    write("rust-toolchain.toml", TOOLCHAIN);
    expect(detectRust(root)).toBeNull();
  });

  test("reads a workspace with a lockfile and rust-toolchain.toml", () => {
    write("Cargo.toml", WORKSPACE);
    write("Cargo.lock", "version = 4\n");
    write("rust-toolchain.toml", TOOLCHAIN);
    expect(detectRust(root)).toEqual({
      workspace: true,
      hasLockfile: true,
      toolchain: "1.100.0",
      toolchainSource: "rust-toolchain.toml",
      toolchainFile: "rust-toolchain.toml",
    });
  });

  test("reads a single package with no lockfile", () => {
    write("Cargo.toml", PACKAGE);
    write("rust-toolchain.toml", TOOLCHAIN);
    const rust = detectRust(root);
    expect(rust?.workspace).toBe(false);
    expect(rust?.hasLockfile).toBe(false);
  });

  test("a mise config naming rust wins over rust-toolchain.toml", () => {
    write("Cargo.toml", WORKSPACE);
    write("rust-toolchain.toml", TOOLCHAIN);
    write(".mise.toml", '[tools]\nbun = "1.4.4"\nrust = "1.99.0"\n');
    const rust = detectRust(root);
    expect(rust?.toolchain).toBe("1.99.0");
    expect(rust?.toolchainSource).toBe("mise");
    expect(rust?.toolchainFile).toBe(".mise.toml");
  });

  test("a mise config without rust falls through to rust-toolchain.toml", () => {
    write("Cargo.toml", WORKSPACE);
    write("rust-toolchain.toml", TOOLCHAIN);
    write("mise.toml", '[tools]\nnode = "22"\n');
    expect(detectRust(root)?.toolchainSource).toBe("rust-toolchain.toml");
  });

  test("reports no toolchain when the repository pins none", () => {
    write("Cargo.toml", PACKAGE);
    const rust = detectRust(root);
    expect(rust?.toolchain).toBe("");
    expect(rust?.toolchainSource).toBe("");
    expect(rust?.toolchainFile).toBe("");
  });

  test("finds a toolchain file above a project in a subfolder", () => {
    write("rust-toolchain.toml", TOOLCHAIN);
    write("services/engine/Cargo.toml", PACKAGE);
    const rust = detectRust(resolve(root, "services/engine"), root);
    expect(rust?.toolchain).toBe("1.100.0");
    expect(rust?.toolchainFile).toBe("rust-toolchain.toml");
  });

  test("does not look above stopAt", () => {
    write("rust-toolchain.toml", TOOLCHAIN);
    write("repo/Cargo.toml", PACKAGE);
    const repo = resolve(root, "repo");
    expect(detectRust(repo, repo)?.toolchainSource).toBe("");
  });
});

describe("readMisePin", () => {
  test("reads a quoted core:rust key", () => {
    write("mise.toml", '[tools]\n"core:rust" = "1.98.0"\n');
    expect(readMisePin(root)?.toolchain).toBe("1.98.0");
  });

  test("reads .tool-versions", () => {
    write(".tool-versions", "nodejs 22.1.0\nrust 1.97.0\n");
    expect(readMisePin(root)).toMatchObject({
      toolchain: "1.97.0",
      source: "mise",
    });
  });

  test("an inline-table version is not read", () => {
    write("mise.toml", '[tools]\nrust = { version = "1.100.0" }\n');
    expect(readMisePin(root)).toBeNull();
  });
});

describe("readRustupPin", () => {
  test("reads a bare channel from the legacy rust-toolchain file", () => {
    write("rust-toolchain", "nightly-2026-11-01\n");
    expect(readRustupPin(root)).toMatchObject({
      toolchain: "nightly-2026-11-01",
      source: "rust-toolchain",
    });
  });

  test("reads TOML in the legacy rust-toolchain file", () => {
    write("rust-toolchain", TOOLCHAIN);
    expect(readRustupPin(root)?.toolchain).toBe("1.100.0");
  });

  test("a rust-toolchain.toml without a channel is no pin", () => {
    write("rust-toolchain.toml", '[toolchain]\ncomponents = ["clippy"]\n');
    expect(readRustupPin(root)).toBeNull();
  });
});

describe("detect", () => {
  test("reports rust beside node, not instead of it", () => {
    write("package.json", "{}");
    write("Cargo.toml", WORKSPACE);
    write("rust-toolchain.toml", TOOLCHAIN);
    const result = detect(root);
    expect(result.languages).toEqual(["node", "rust"]);
    expect(result.hasNode).toBe(true);
    expect(result.hasRust).toBe(true);
  });

  test("a repository with no Cargo.toml has no rust", () => {
    write("package.json", "{}");
    const result = detect(root);
    expect(result.hasRust).toBe(false);
    expect(result.rust).toBeUndefined();
  });

  test("formatOutputs emits the rust keys", () => {
    write("Cargo.toml", WORKSPACE);
    write("Cargo.lock", "version = 4\n");
    write("rust-toolchain.toml", TOOLCHAIN);
    const lines = formatOutputs(detect(root)).trimEnd().split("\n");
    expect(lines).toContain("languages=rust");
    expect(lines.slice(-6)).toEqual([
      "has-rust=true",
      "rust-workspace=true",
      "rust-has-lockfile=true",
      "rust-toolchain=1.100.0",
      "rust-toolchain-source=rust-toolchain.toml",
      "rust-toolchain-file=rust-toolchain.toml",
    ]);
  });
});
