#!/usr/bin/env bash
# Audits a .NET project's NuGet dependencies with the SDK's own package
# audit and writes the findings markdown. Called by action.yml, which sets:
#
#   TARGET                  solution or project, or "" to build a solution
#                           from PROJECTS
#   PROJECTS                project files, one per line
#   OUT_PATH                findings markdown to write
#   FAIL_ON_VULN            "true" to exit 1 when advisories are found
#   FAIL_ON_INDETERMINATE   "true" to exit 1 when the audit could not run
#   ACTION_PATH             this action's folder
#
# An audit that could not run is reported as indeterminate, never as a
# pass, for the reason python-audit gives.
set -uo pipefail

VULNERABLE="${RUNNER_TEMP}/dotnet-vulnerable.json"
ALL="${RUNNER_TEMP}/dotnet-packages.json"
ERRORS="${RUNNER_TEMP}/dotnet-audit.err"

mkdir -p "$(dirname "$OUT_PATH")"
rm -f "$OUT_PATH" "$VULNERABLE" "$ALL"

write_indeterminate() {
  {
    echo "⚪ **Audit did not complete** — $1."
    echo ""
    echo "This is not a pass. Dependencies were not checked against any advisory database on this run."
  } > "$OUT_PATH"
}

give_up() {
  echo "::warning title=.NET Audit::$1"
  echo "status=indeterminate" >> "$GITHUB_OUTPUT"
  if ! node "${ACTION_PATH}/dist/findings-audit.js" --format dotnet --reason "$1" --out "$OUT_PATH"; then
    write_indeterminate "$1"
  fi
  if [ "$FAIL_ON_INDETERMINATE" = "true" ]; then
    echo "::error title=.NET Audit::the dependency audit did not run, so this job reports nothing about advisories. Fix the cause above, or set fail-on-indeterminate: false to accept a green row for an audit that checked nothing."
    exit 1
  fi
  exit 0
}

if ! command -v dotnet >/dev/null 2>&1; then
  give_up "the .NET SDK is not installed on the runner"
fi

if [ -z "$TARGET" ]; then
  sln_dir="$RUNNER_TEMP/dotnet-audit-sln"
  rm -rf "$sln_dir"
  mkdir -p "$sln_dir"
  dotnet new sln --name ci --output "$sln_dir" > /dev/null || give_up "could not create a solution for the projects"
  TARGET="$(find "$sln_dir" -maxdepth 1 -name 'ci.sln*' | head -n 1)"
  project_list=()
  while IFS= read -r p; do
    [ -n "$p" ] && project_list+=("$PWD/$p")
  done <<< "$PROJECTS"
  if [ "${#project_list[@]}" -eq 0 ]; then
    give_up "no .NET project file was found"
  fi
  dotnet sln "$TARGET" add "${project_list[@]}" > /dev/null || give_up "could not add the projects to a solution"
fi

# The package listing reads the restore output. NuGet's own audit is off
# here because this step reports the same advisories, and a project that
# treats warnings as errors would otherwise fail the restore on them.
echo "::group::dotnet restore"
dotnet restore "$TARGET" -p:NuGetAudit=false -p:TreatWarningsAsErrors=false
restore_status=$?
echo "::endgroup::"
if [ "$restore_status" -ne 0 ]; then
  give_up "dotnet restore failed (exit $restore_status)"
fi

# `dotnet package list` is the SDK 10 spelling; older SDKs only know
# `dotnet list package`. The vulnerability data comes from the package
# sources' audit feeds, nuget.org's by default, with no account or key.
list_packages() {
  if dotnet package list --help >/dev/null 2>&1; then
    dotnet package list --project "$TARGET" "$@"
  else
    dotnet list "$TARGET" package "$@"
  fi
}

list_packages --vulnerable --include-transitive --format json > "$VULNERABLE" 2> "$ERRORS"
vuln_status=$?
list_packages --include-transitive --format json > "$ALL" 2>> "$ERRORS"

if [ "$vuln_status" -ne 0 ] || [ ! -s "$VULNERABLE" ]; then
  echo "::group::dotnet package list stderr"
  cat "$ERRORS" 2>/dev/null || true
  echo "::endgroup::"
  give_up "dotnet package list exited $vuln_status without a report"
fi

if ! node "${ACTION_PATH}/dist/findings-audit.js" --format dotnet \
  --json "$VULNERABLE" --all-json "$ALL" --out "$OUT_PATH"; then
  give_up "the findings writer failed to read the package listing"
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
echo "::notice title=.NET Audit::$STATUS"

if [ "$STATUS" = "indeterminate" ] && [ "$FAIL_ON_INDETERMINATE" = "true" ]; then
  exit 1
fi
if [ "$STATUS" = "vulnerable" ] && [ "$FAIL_ON_VULN" = "true" ]; then
  exit 1
fi
exit 0
