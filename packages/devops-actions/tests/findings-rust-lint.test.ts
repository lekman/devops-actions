/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 */

import { describe, expect, test } from "bun:test";

import { parseLintLog } from "../src/findings-tests";

describe("parseLintLog for Rust", () => {
  test("reads rustfmt --check diff headers in both forms", () => {
    const log = [
      "=== cargo fmt ===",
      "Diff in /work/crates/demo/src/lib.rs:3:",
      " pub fn add(a: u32, b: u32) -> u32 {",
      "-    a+b",
      "+    a + b",
      " }",
      "Diff in /work/src/main.rs at line 7:",
    ].join("\n");
    expect(parseLintLog(log)).toEqual([
      {
        file: "/work/crates/demo/src/lib.rs:3",
        message: "would be reformatted by rustfmt",
        level: "error",
      },
      {
        file: "/work/src/main.rs:7",
        message: "would be reformatted by rustfmt",
        level: "error",
      },
    ]);
  });

  test("reads clippy findings with their location line", () => {
    const log = [
      "=== cargo clippy ===",
      "    Checking demo v0.1.0 (/work/crates/demo)",
      "error: this `if` has identical blocks",
      "  --> crates/demo/src/lib.rs:12:5",
      "   |",
      "12 |     if x { 1 } else { 1 }",
      "   |",
      "   = note: `-D clippy::if-same-then-else` implied by `-D warnings`",
      "",
      "error[E0308]: mismatched types",
      " --> crates/demo/src/main.rs:4:18",
      "",
      "error: could not compile `demo` (lib) due to 2 previous errors",
    ].join("\n");
    expect(parseLintLog(log)).toEqual([
      {
        file: "crates/demo/src/lib.rs:12:5",
        message: "this `if` has identical blocks",
        level: "error",
      },
      {
        file: "crates/demo/src/main.rs:4:18",
        message: "mismatched types",
        level: "error",
      },
    ]);
  });

  test("keeps a warning as a warning", () => {
    const log = "warning: unused variable: `y`\n --> src/lib.rs:2:9\n";
    expect(parseLintLog(log)).toEqual([
      {
        file: "src/lib.rs:2:9",
        message: "unused variable: `y`",
        level: "warning",
      },
    ]);
  });

  test("skips summary lines that carry no location", () => {
    const log = [
      "warning: `demo` (lib) generated 1 warning",
      "error: could not compile `demo` (lib test) due to 1 previous error",
    ].join("\n");
    expect(parseLintLog(log)).toEqual([]);
  });
});
