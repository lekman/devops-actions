#!/usr/bin/env bash
# Audits a Gradle or Maven project's dependencies with OSV-Scanner and
# writes the findings markdown. Called by action.yml, which sets:
#
#   BUILD_TOOL              gradle or maven
#   OUT_PATH                findings markdown to write
#   FAIL_ON_VULN            "true" to exit 1 when advisories are found
#   FAIL_ON_INDETERMINATE   "true" to exit 1 when the audit could not run
#   ACTION_PATH             this action's folder
#   OSV_SCANNER             path to the verified osv-scanner binary
#
# An audit that could not run is reported as indeterminate, never as a
# pass, for the reason python-audit gives: a zero from a tool that never
# executed looks exactly like a clean result.
set -uo pipefail

REPORT="${RUNNER_TEMP:-/tmp}/osv-scanner.json"
ERRORS="${RUNNER_TEMP:-/tmp}/osv-scanner.err"

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
  echo "::warning title=JVM Audit::$1"
  echo "status=indeterminate" >> "$GITHUB_OUTPUT"
  if ! node "${ACTION_PATH}/dist/findings-audit.js" --format osv-scanner --reason "$1" --out "$OUT_PATH"; then
    write_indeterminate "$1"
  fi
  if [ "$FAIL_ON_INDETERMINATE" = "true" ]; then
    echo "::error title=JVM Audit::the dependency audit did not run, so this job reports nothing about advisories. Fix the cause above, or set fail-on-indeterminate: false to accept a green row for an audit that checked nothing."
    exit 1
  fi
  exit 0
}

if [ ! -x "$OSV_SCANNER" ]; then
  give_up "osv-scanner is not installed on the runner"
fi

# ── Resolved versions for Gradle ────────────────────────────────────────
# OSV-Scanner reads Gradle's lockfiles, not build scripts, because a
# build script names version ranges, platforms and plugins that only
# Gradle can resolve. A build that commits lockfiles is read as it is.
# One that commits none gets them written here by Gradle itself, through
# an init script, so the versions audited are the ones Gradle resolves.
if [ "$BUILD_TOOL" = "gradle" ]; then
  committed=$(find . -name 'gradle.lockfile' -not -path '*/build/*' -not -path '*/.*/*' | head -n 1)
  if [ -n "$committed" ]; then
    echo "::notice title=JVM Audit::reading the committed Gradle lockfiles"
  else
    if [ -x ./gradlew ]; then
      gradle_cmd=(./gradlew)
    elif command -v gradle >/dev/null 2>&1; then
      gradle_cmd=(gradle)
    else
      give_up "no Gradle wrapper (gradlew) and no gradle on PATH, so dependencies could not be resolved"
    fi
    echo "::group::Resolve dependencies and write lockfiles"
    "${gradle_cmd[@]}" --console=plain --no-configuration-cache \
      --init-script "$ACTION_PATH/lock.init.gradle" \
      ciResolveAndLockAll --write-locks
    lock_status=$?
    echo "::endgroup::"
    if [ "$lock_status" -ne 0 ]; then
      give_up "Gradle could not resolve the dependencies (exit $lock_status)"
    fi
    if [ -z "$(find . -name 'gradle.lockfile' -not -path '*/build/*' -not -path '*/.*/*' | head -n 1)" ]; then
      give_up "Gradle wrote no lockfile, so there were no classpath dependencies to read"
    fi
  fi
fi

# ── Scan ────────────────────────────────────────────────────────────────
# Gradle lockfiles are named one by one. A recursive scan skips files the
# repository's .gitignore lists, and a repository that ignores lockfiles
# would otherwise have the ones written above skipped. Only gradle.lockfile
# is read: buildscript-gradle.lockfile holds build plugins, not product
# dependencies. Maven poms are found by a recursive scan, so every module
# of a multi-module build is read.
scan_args=()
if [ "$BUILD_TOOL" = "gradle" ]; then
  while IFS= read -r lockfile; do
    [ -n "$lockfile" ] && scan_args+=(--lockfile "$lockfile")
  done <<< "$(find . -name 'gradle.lockfile' -not -path '*/build/*' -not -path '*/.*/*' | sort)"
  if [ "${#scan_args[@]}" -eq 0 ]; then
    give_up "no gradle.lockfile to read"
  fi
else
  scan_args=(--recursive .)
fi

# --all-packages lists every package, so the summary can say how many
# were checked. Exit codes: 0 no advisories, 1 advisories, 128 nothing
# to scan, anything else an error.
"$OSV_SCANNER" scan source --all-packages --format json "${scan_args[@]}" \
  > "$REPORT" 2> "$ERRORS"
scan_status=$?

if [ "$scan_status" -eq 128 ]; then
  give_up "osv-scanner found no lockfile or pom.xml to read"
fi
if [ "$scan_status" -ne 0 ] && [ "$scan_status" -ne 1 ]; then
  echo "::group::osv-scanner stderr"
  cat "$ERRORS" 2>/dev/null || true
  echo "::endgroup::"
  give_up "osv-scanner exited $scan_status"
fi
if [ ! -s "$REPORT" ]; then
  give_up "osv-scanner exited $scan_status without writing a report"
fi

if ! node "${ACTION_PATH}/dist/findings-audit.js" --format osv-scanner --json "$REPORT" --out "$OUT_PATH"; then
  give_up "the findings writer failed to read osv-scanner's report"
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
echo "::notice title=JVM Audit::$STATUS"

if [ "$STATUS" = "indeterminate" ] && [ "$FAIL_ON_INDETERMINATE" = "true" ]; then
  exit 1
fi
if [ "$STATUS" = "vulnerable" ] && [ "$FAIL_ON_VULN" = "true" ]; then
  exit 1
fi
exit 0
