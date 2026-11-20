#!/usr/bin/env bash
# Runs the dotnet-quality phases in the project directory: restore, build
# with analyzers and warnings as errors, format check, tests with coverage,
# coverage floor. Called by action.yml, which sets every variable below.
#
# Every phase runs even when an earlier one fails, and the script exits
# non-zero at the end if any of them did. Each phase's result is a step
# output (passed, failed or skipped), so a caller, and this repository's
# own CI, can tell which check failed.
#
#   TARGET                solution or project to run against, or "" to
#                         build a solution from PROJECTS
#   PROJECTS              project files, one per line
#   TEST_RUNNER           vstest or mtp
#   HAS_EDITORCONFIG      "true" when the repository has an .editorconfig
#   OWNS_COVERAGE_FLOOR   "true" when a project sets coverlet's Threshold
#   OWNS_RUN_SETTINGS     "true" when a project names RunSettingsFilePath
#   USES_COVERLET         "true" when a test project references coverlet.collector
#   FINDINGS_DIR          where build.log, format.log and test.log go
#   RESULTS_DIR           where TRX, JUnit and coverage files go
#   COVERAGE_THRESHOLD    minimum line coverage, percent
#   EXTRA_ARGS            appended to dotnet build and dotnet test
#   ACTION_PATH           this action's folder
#
# Written for bash 3.2 as well, the /bin/bash a macOS runner has. Under
# `set -u` that version treats an empty array as unset, hence the
# ${arr[@]+"${arr[@]}"} form for arrays that may be empty.

# No `set -e`: every phase runs, and EXIT carries the verdict.
set -uo pipefail

mkdir -p "$FINDINGS_DIR" "$RESULTS_DIR"
# Results from an earlier run in the same job would be read as this run's.
find "$RESULTS_DIR" -mindepth 1 -delete
BUILD_LOG="$FINDINGS_DIR/build.log"
FORMAT_LOG="$FINDINGS_DIR/format.log"
TEST_LOG="$FINDINGS_DIR/test.log"
: > "$BUILD_LOG"
: > "$FORMAT_LOG"
: > "$TEST_LOG"
EXIT=0

output() { echo "$1=$2" >> "$GITHUB_OUTPUT"; }

cap_log() {
  local f="$1"
  if [ -f "$f" ] && [ "$(wc -c < "$f")" -gt 200000 ]; then
    head -c 200000 "$f" > "$f.capped" && mv "$f.capped" "$f"
    echo "… log truncated at 200 kB" >> "$f"
  fi
}

read -ra extra <<< "$EXTRA_ARGS"

# The strict defaults (strict.props) apply to every project through this
# hook, and only where the repository leaves a property unset.
STRICT=("-p:CustomBeforeMicrosoftCommonProps=$ACTION_PATH/strict.props")

# ── Default .editorconfig ───────────────────────────────────────────────
if [ "$HAS_EDITORCONFIG" != "true" ]; then
  cp "$ACTION_PATH/defaults/.editorconfig" .editorconfig
  echo "::notice title=.NET Quality::no .editorconfig in the repository, so the action's default is used for this run. See the dotnet-quality README"
fi

# ── What to run against ─────────────────────────────────────────────────
if [ -z "$TARGET" ]; then
  # No single solution or project at the root. Gather every project into
  # a solution outside the checkout, so one restore, build and test covers
  # them all.
  sln_dir="$RUNNER_TEMP/dotnet-quality-sln"
  rm -rf "$sln_dir"
  mkdir -p "$sln_dir"
  dotnet new sln --name ci --output "$sln_dir" > /dev/null
  TARGET="$(find "$sln_dir" -maxdepth 1 -name 'ci.sln*' | head -n 1)"
  project_list=()
  while IFS= read -r p; do
    [ -n "$p" ] && project_list+=("$PWD/$p")
  done <<< "$PROJECTS"
  if [ "${#project_list[@]}" -gt 0 ]; then
    dotnet sln "$TARGET" add ${project_list[@]+"${project_list[@]}"} > /dev/null
  fi
  echo "::notice title=.NET Quality::no single solution at the project root, so a solution of all ${#project_list[@]} project(s) was built for this run"
fi

# ── Restore ─────────────────────────────────────────────────────────────
restore=failed
echo "=== dotnet restore ===" | tee -a "$BUILD_LOG"
dotnet restore "$TARGET" "${STRICT[@]}" 2>&1 | tee -a "$BUILD_LOG"
if [ "${PIPESTATUS[0]}" -eq 0 ]; then restore=passed; fi

# ── Build: compiler, analyzers, code style, warnings as errors ──────────
build=failed
if [ "$restore" = "passed" ]; then
  echo "=== dotnet build ===" | tee -a "$BUILD_LOG"
  dotnet build "$TARGET" --no-restore "${STRICT[@]}" \
    ${extra[@]+"${extra[@]}"} 2>&1 | tee -a "$BUILD_LOG"
  if [ "${PIPESTATUS[0]}" -eq 0 ]; then build=passed; fi
fi
cap_log "$BUILD_LOG"

# ── Format: whitespace, style and analyzers ─────────────────────────────
format=failed
if [ "$restore" = "passed" ]; then
  echo "=== dotnet format --verify-no-changes ===" | tee -a "$FORMAT_LOG"
  dotnet format "$TARGET" --verify-no-changes --no-restore 2>&1 | tee -a "$FORMAT_LOG"
  if [ "${PIPESTATUS[0]}" -eq 0 ]; then format=passed; fi
fi
cap_log "$FORMAT_LOG"

# ── Test, with TRX results and Cobertura coverage ───────────────────────
test=failed
coverage_args=()
report_args=()
build_args=()

if [ "$build" = "passed" ]; then
  build_args=(--no-build)
else
  # The strict build failed, which the build phase already reports. Build
  # again without warnings as errors, so the tests still run and report.
  build_args=(--no-restore "${STRICT[@]}" -p:TreatWarningsAsErrors=false)
fi

if [ "$TEST_RUNNER" = "mtp" ]; then
  case "$TARGET" in
    *.sln | *.slnx) select_args=(--solution "$TARGET") ;;
    *) select_args=(--project "$TARGET") ;;
  esac
  # Which report and coverage options exist depends on the extensions the
  # test projects reference, so ask the test applications themselves.
  help="$(dotnet test "${select_args[@]}" "${build_args[@]}" --help 2>&1)"
  if grep -q -- '--report-trx ' <<< "$help"; then
    report_args=(--report-trx)
  elif grep -q -- '--report-xunit-trx ' <<< "$help"; then
    report_args=(--report-xunit-trx)
  else
    echo "::warning title=.NET Quality::the test projects offer no TRX report, so no JUnit file is written. Reference Microsoft.Testing.Extensions.TrxReport"
  fi
  if grep -q -- '--coverage-output-format' <<< "$help"; then
    coverage_args=(--coverage --coverage-output-format cobertura)
  elif grep -q -- '--coverlet-output-format' <<< "$help"; then
    coverage_args=(--coverlet --coverlet-output-format cobertura)
  else
    echo "::error title=.NET Quality::the test projects reference no coverage extension, so coverage cannot be measured. Reference Microsoft.Testing.Extensions.CodeCoverage or coverlet.MTP"
  fi
  echo "=== dotnet test (Microsoft Testing Platform) ===" | tee -a "$TEST_LOG"
  dotnet test "${select_args[@]}" "${build_args[@]}" \
    --results-directory "$RESULTS_DIR" \
    ${report_args[@]+"${report_args[@]}"} ${coverage_args[@]+"${coverage_args[@]}"} \
    ${extra[@]+"${extra[@]}"} 2>&1 | tee -a "$TEST_LOG"
  if [ "${PIPESTATUS[0]}" -eq 0 ]; then test=passed; fi
else
  if [ "$USES_COVERLET" = "true" ]; then
    coverage_args=(--collect "XPlat Code Coverage;Format=cobertura")
  else
    # Microsoft's collector ships in Microsoft.NET.Test.Sdk, which every
    # VSTest project references. Its default counts the test assembly as
    # covered code, so a run settings file turns that off, unless the
    # project names run settings of its own.
    coverage_args=(--collect "Code Coverage;Format=cobertura")
    if [ "$OWNS_RUN_SETTINGS" != "true" ]; then
      coverage_args+=(--settings "$ACTION_PATH/coverage.runsettings")
    fi
  fi
  echo "=== dotnet test (VSTest) ===" | tee -a "$TEST_LOG"
  dotnet test "$TARGET" "${build_args[@]}" \
    --results-directory "$RESULTS_DIR" --logger trx \
    "${coverage_args[@]}" ${extra[@]+"${extra[@]}"} 2>&1 | tee -a "$TEST_LOG"
  if [ "${PIPESTATUS[0]}" -eq 0 ]; then test=passed; fi
fi
cap_log "$TEST_LOG"

# ── JUnit from TRX ──────────────────────────────────────────────────────
junit_path=""
junit_out="$(mktemp)"
GITHUB_OUTPUT="$junit_out" node "$ACTION_PATH/dist/trx-junit.js" \
  --trx "$RESULTS_DIR" --out "$RESULTS_DIR/junit.xml"
junit_path="$(sed -n 's/^junit-path=//p' "$junit_out")"
rm -f "$junit_out"

coverage_files="$(find "$RESULTS_DIR" -type f -name '*.xml' ! -name 'junit.xml' | sort)"

# ── Coverage floor ──────────────────────────────────────────────────────
coverage=skipped
check_out="$(mktemp)"
if [ "$OWNS_COVERAGE_FLOOR" = "true" ]; then
  GITHUB_OUTPUT="$check_out" node "$ACTION_PATH/dist/coverage-check.js" \
    --reports "$coverage_files" --threshold 0 > /dev/null 2>&1
  echo "::notice title=.NET Quality::a project sets coverlet's Threshold, so the ${COVERAGE_THRESHOLD}% default floor is not applied"
else
  GITHUB_OUTPUT="$check_out" node "$ACTION_PATH/dist/coverage-check.js" \
    --reports "$coverage_files" --threshold "$COVERAGE_THRESHOLD"
  case "$(sed -n 's/^result=//p' "$check_out")" in
    passed) coverage=passed ;;
    *) coverage=failed ;;
  esac
fi
percent="$(sed -n 's/^percent=//p' "$check_out")"
rm -f "$check_out"

# ── Verdict ─────────────────────────────────────────────────────────────
output restore-result "$restore"
output build-result "$build"
output format-result "$format"
output test-result "$test"
output coverage-result "$coverage"
output coverage-percent "$percent"
output junit-path "$junit_path"
{
  echo 'coverage-paths<<COVERAGE_EOF'
  [ -n "$coverage_files" ] && echo "$coverage_files"
  echo 'COVERAGE_EOF'
} >> "$GITHUB_OUTPUT"
output build-log "$BUILD_LOG"
output format-log "$FORMAT_LOG"
output test-log "$TEST_LOG"

{
  echo "### .NET Quality"
  echo ""
  echo "| Phase | Result |"
  echo "| ----- | ------ |"
  echo "| Restore | $restore |"
  echo "| Build, analyzers, warnings as errors | $build |"
  echo "| Format | $format |"
  echo "| Tests ($TEST_RUNNER) | $test |"
  echo "| Coverage floor (${COVERAGE_THRESHOLD}%) | $coverage${percent:+ ($percent%)} |"
} >> "$GITHUB_STEP_SUMMARY"

if [ "$restore" = "failed" ]; then
  echo "::error title=.NET Quality::dotnet restore failed, see build.log"
fi
if [ "$build" = "failed" ] && [ "$restore" = "passed" ]; then
  echo "::error title=.NET Quality::the build reported errors or warnings, which fail the build here. See build.log"
fi
if [ "$format" = "failed" ] && [ "$restore" = "passed" ]; then
  echo "::error title=.NET Quality::dotnet format found changes to make. Run 'dotnet format' and commit the result. See format.log"
fi
if [ "$test" = "failed" ]; then
  echo "::error title=.NET Quality::tests failed or did not run, see test.log"
fi

for r in "$restore" "$build" "$format" "$test" "$coverage"; do
  if [ "$r" = "failed" ]; then EXIT=1; fi
done
exit "$EXIT"
