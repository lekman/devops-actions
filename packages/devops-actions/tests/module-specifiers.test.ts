/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Compiled modules are copied into `.github/actions/<name>/dist/` and run
 * as bare `node <entry>.js`, under node's ESM resolver. That resolver does
 * not append extensions, so a relative import written without `.js`
 * compiles and unit-tests fine and then fails only on a runner with
 * ERR_MODULE_NOT_FOUND.
 *
 * Bun and tsc both accept either form, so nothing else in the toolchain
 * catches this.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(import.meta.dir, "..", "src");

const RELATIVE_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["'](\.[^"']*)["']/g;

function sourceFiles(): string[] {
  return readdirSync(SRC).filter((f) => f.endsWith(".ts"));
}

describe("relative import specifiers", () => {
  test.each(sourceFiles())("%s imports siblings with a .js suffix", (file) => {
    const contents = readFileSync(resolve(SRC, file), "utf8");
    const offenders = [...contents.matchAll(RELATIVE_IMPORT)]
      .map((m) => m[1])
      .filter((specifier) => !specifier.endsWith(".js"));
    expect(offenders).toEqual([]);
  });
});
