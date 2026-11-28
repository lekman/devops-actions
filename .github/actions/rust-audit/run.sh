#!/usr/bin/env bash
# Audits Cargo.lock with cargo-audit and writes the findings markdown.
# Called by action.yml, which sets:
#
#   OUT_PATH                findings markdown to write
#   FAIL_ON_VULN            "true" to exit 1 when advisories are found
#   FAIL_ON_INDETERMINATE   "true" to exit 1 when the audit could not run
#   ACTION_PATH             this action's folder
#
# An audit that could not run is reported as indeterminate, never as a
# pass, for the reason python-audit gives: a zero from a tool that never
# executed looks exactly like a clean result.
set -uo pipefail

REPORT="${RUNNER_TEMP:-/tmp}/cargo-audit.json"
ERRORS="${RUNNER_TEMP:-/tmp}/cargo-audit.err"

mkdir -p "$(dirname "$OUT_PATH")"
rm -f "$OUT_PATH" "$REPORT"

write_indeterminate() {
  {
    echo "⚪ **Audit did not complete** — $1."
    echo ""
    echo "This is not a pass. Dependencies were not checked against any advisory database on this run."
  } > "$OUT_PATH"
}

give_up() {
  echo "::warning title=Rust Audit::$1"
  echo "status=indeterminate" >> "$GITHUB_OUTPUT"
  if ! node "${ACTION_PATH}/dist/findings-audit.js" --format cargo-audit --reason "$1" --out "$OUT_PATH"; then
    write_indeterminate "$1"
  fi
  if [ "$FAIL_ON_INDETERMINATE" = "true" ]; then
    echo "::error title=Rust Audit::the dependency audit did not run, so this job reports nothing about advisories. Fix the cause above, or set fail-on-indeterminate: false to accept a green row for an audit that checked nothing."
    exit 1
  fi
  exit 0
}

if ! command -v cargo-audit >/dev/null 2>&1; then
  give_up "cargo-audit is not installed on the runner"
fi
# cargo-audit would otherwise resolve a lockfile itself, which needs cargo
# and audits versions the repository never chose.
if [ ! -f Cargo.lock ]; then
  give_up "there is no Cargo.lock to read; commit it beside Cargo.toml"
fi

# Exit codes: 0 no advisories, 1 advisories found or an error. The JSON
# report is what tells the two apart, so an empty one is indeterminate.
cargo-audit audit --json --file Cargo.lock > "$REPORT" 2> "$ERRORS"
audit_status=$?

if [ ! -s "$REPORT" ]; then
  echo "::group::cargo-audit stderr"
  cat "$ERRORS" 2>/dev/null || true
  echo "::endgroup::"
  give_up "cargo-audit exited $audit_status without writing a report"
fi

if ! node "${ACTION_PATH}/dist/findings-audit.js" --format cargo-audit --json "$REPORT" --out "$OUT_PATH"; then
  give_up "the findings writer failed to read cargo-audit's report"
fi
if [ ! -s "$OUT_PATH" ]; then
  give_up "the findings writer produced an empty report"
fi

if grep -q "did not complete" "$OUT_PATH"; then
  STATUS=indeterminate
elif grep -q "No known vulnerabilities" "$OUT_PATH"; then
  STATUS=clean
else
  STATUS=vulnerable
fi
echo "status=$STATUS" >> "$GITHUB_OUTPUT"
echo "::notice title=Rust Audit::$STATUS"

if [ "$STATUS" = "indeterminate" ] && [ "$FAIL_ON_INDETERMINATE" = "true" ]; then
  exit 1
fi
if [ "$STATUS" = "vulnerable" ] && [ "$FAIL_ON_VULN" = "true" ]; then
  exit 1
fi
exit 0
