#!/usr/bin/env bash
# Runs the rust-quality phases in the folder that holds Cargo.toml: format,
# lint, test. Called by action.yml, which sets:
#
#   FINDINGS_DIR   where rust-lint.log and rust-test.log go
#   ACTION_PATH    this action's folder, which holds nextest.toml
#   TARGET_DIR     cargo's target directory
#
# Every phase runs even when an earlier one fails, and the script exits
# non-zero at the end if any of them did, the same as python-quality. Each
# phase's result is written as a step output (passed or failed), so a
# caller, and this repository's own CI, can tell which check failed.
#
# Written for bash 3.2 as well, the /bin/bash a macOS runner has.
set -uo pipefail

mkdir -p "$FINDINGS_DIR"
LINT_LOG="$FINDINGS_DIR/rust-lint.log"
TEST_LOG="$FINDINGS_DIR/rust-test.log"
: > "$LINT_LOG"
: > "$TEST_LOG"
EXIT=0
PROFILE=devops-ci
JUNIT="$PWD/junit.xml"
LCOV="$PWD/coverage/lcov.info"
rm -f "$JUNIT" "$LCOV"

output() { echo "$1=$2" >> "$GITHUB_OUTPUT"; }

# Keep the head of an over-long log. The findings parser takes the first
# findings it sees, so the top of the file is the part that informs.
cap_log() {
  local f="$1"
  if [ -f "$f" ] && [ "$(wc -c < "$f")" -gt 200000 ]; then
    head -c 200000 "$f" > "$f.capped" && mv "$f.capped" "$f"
    echo "… log truncated at 200 kB" >> "$f"
  fi
}

# Every cargo call below passes --locked, so a missing lockfile fails each
# of them with a message about updating it. Say what to do once, first.
if [ ! -f Cargo.lock ]; then
  echo "::error title=Rust Quality::no Cargo.lock beside Cargo.toml. Commit it: the lint and test phases build with --locked, so CI uses the versions the repository chose."
fi

# ── Format ──────────────────────────────────────────────────────────────
echo "=== cargo fmt ===" | tee -a "$LINT_LOG"
cargo fmt --all --check 2>&1 | tee -a "$LINT_LOG"
if [ "${PIPESTATUS[0]}" -ne 0 ]; then format=failed; EXIT=1; else format=passed; fi
output format-result "$format"

# ── Lint ────────────────────────────────────────────────────────────────
# --all-targets covers tests, benches and examples too. -D warnings turns
# every warning, the compiler's and clippy's, into an error, so the job
# fails on anything a developer would see as a warning locally.
echo "=== cargo clippy ===" | tee -a "$LINT_LOG"
cargo clippy --workspace --all-targets --locked --color never -- -D warnings 2>&1 \
  | tee -a "$LINT_LOG"
if [ "${PIPESTATUS[0]}" -ne 0 ]; then lint=failed; EXIT=1; else lint=passed; fi
output lint-result "$lint"
cap_log "$LINT_LOG"

# ── Test ────────────────────────────────────────────────────────────────
# cargo-llvm-cov builds the tests with coverage instrumentation and runs
# them through cargo-nextest, so one run gives both reports. nextest writes
# JUnit for the profile in nextest.toml, and --no-tests=warn lets a crate
# without tests pass, as `cargo test` does. nextest does not run doctests,
# so those run afterwards with cargo test, outside the coverage numbers.
test=passed
tools="rustc $(rustc --version | cut -d' ' -f2)"

if command -v cargo-nextest >/dev/null 2>&1 && command -v cargo-llvm-cov >/dev/null 2>&1; then
  tools="$tools, $(cargo nextest --version 2>/dev/null | head -n 1 | cut -d' ' -f1-2), $(cargo llvm-cov --version 2>/dev/null | head -n 1)"
  mkdir -p "$(dirname "$LCOV")"
  echo "=== cargo llvm-cov nextest ===" | tee -a "$TEST_LOG"
  NEXTEST_PROFILE="$PROFILE" cargo llvm-cov nextest --workspace --locked \
    --no-tests=warn \
    --tool-config-file="devops-actions:$ACTION_PATH/nextest.toml" \
    --lcov --output-path "$LCOV" 2>&1 | tee -a "$TEST_LOG"
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then test=failed; EXIT=1; fi

  # nextest keeps its store under the target directory it ran in, which
  # cargo-llvm-cov may move, so the report is looked for under both.
  report=$(find "$TARGET_DIR" -path "*/nextest/$PROFILE/junit.xml" -type f 2>/dev/null | head -n 1)
  if [ -n "$report" ]; then
    cp "$report" "$JUNIT"
  else
    echo "::warning title=Rust Quality::cargo-nextest wrote no JUnit report under $TARGET_DIR"
  fi
  # cargo-llvm-cov writes the report only after a passing run.
  if [ ! -s "$LCOV" ]; then
    rm -f "$LCOV"
    if [ "$test" = "passed" ]; then
      echo "::warning title=Rust Quality::cargo-llvm-cov wrote no LCOV report"
    fi
  fi

  # Doctests exist only in library crates, and `cargo test --doc` fails on
  # a workspace that has none.
  libs=$(cargo metadata --no-deps --format-version 1 --locked 2>/dev/null \
    | jq '[.packages[].targets[] | select(any(.kind[]; . == "lib" or . == "rlib" or . == "proc-macro"))] | length' 2>/dev/null)
  if [ "${libs:-0}" -gt 0 ]; then
    echo "=== cargo test --doc ===" | tee -a "$TEST_LOG"
    cargo test --workspace --locked --doc 2>&1 | tee -a "$TEST_LOG"
    if [ "${PIPESTATUS[0]}" -ne 0 ]; then test=failed; EXIT=1; fi
  fi
else
  echo "::warning title=Rust Quality::cargo-nextest or cargo-llvm-cov is missing, so the tests run with cargo test and write no JUnit or coverage report"
  echo "=== cargo test ===" | tee -a "$TEST_LOG"
  cargo test --workspace --locked 2>&1 | tee -a "$TEST_LOG"
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then test=failed; EXIT=1; fi
fi
output test-result "$test"
cap_log "$TEST_LOG"

if [ -f "$JUNIT" ]; then output junit-path "$JUNIT"; else output junit-path ""; fi
if [ -f "$LCOV" ]; then output lcov-path "$LCOV"; else output lcov-path ""; fi
output lint-log "$LINT_LOG"
output test-log "$TEST_LOG"
output tool-versions "$tools"

{
  echo "### Rust Quality"
  echo ""
  echo "| Phase | Result |"
  echo "|-------|--------|"
  echo "| Format (cargo fmt) | $format |"
  echo "| Lint (cargo clippy) | $lint |"
  echo "| Test | $test |"
  echo ""
  echo "$tools"
} >> "$GITHUB_STEP_SUMMARY"

exit "$EXIT"
