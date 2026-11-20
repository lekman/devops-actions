#!/usr/bin/env bash
# Runs the jvm-quality phases in the project directory: format, static
# analysis, build and test, coverage floor. Called by action.yml, which
# sets every variable below.
#
# Every phase runs even when an earlier one fails, and the script exits
# non-zero at the end if any of them did, the same as python-quality. Each
# phase's result is written as a step output (passed, failed or skipped),
# so a caller, and this repository's own CI, can tell which check failed.
#
#   BUILD_TOOL            gradle or maven
#   FINDINGS_DIR          where lint.log and build.log go
#   COVERAGE_THRESHOLD    minimum line coverage, percent
#   EXTRA_ARGS            appended to the Gradle or Maven command line
#   ACTION_PATH           this action's folder
#   TOOLS_DIR             where the ktlint, detekt and google-java-format
#                         downloads are
#   TOOLS_JAVA            JDK 21 or newer that runs those tools
#   KOTLIN_SOURCES, JAVA_SOURCES, OWNS_KTLINT, OWNS_DETEKT,
#   OWNS_JAVA_FORMAT, OWNS_COVERAGE_FLOOR, GRADLE_VERIFY_TASKS,
#   DETEKT_CONFIG         from project-inspect
#   JACOCO_VERSION        JaCoCo Maven plugin version for a Maven build

# No `set -e`: every phase runs, and EXIT carries the verdict.
#
# Written for bash 3.2 as well, the /bin/bash a macOS runner has. Under
# `set -u` that version treats an empty array as unset, hence the
# ${arr[@]+"${arr[@]}"} form for arrays that may be empty.
set -uo pipefail

mkdir -p "$FINDINGS_DIR"
LINT_LOG="$FINDINGS_DIR/lint.log"
BUILD_LOG="$FINDINGS_DIR/build.log"
: > "$LINT_LOG"
: > "$BUILD_LOG"
EXIT=0
TOOLS_JAVA_BIN="$TOOLS_JAVA/bin/java"

output() { echo "$1=$2" >> "$GITHUB_OUTPUT"; }

# Keep the head of an over-long log. The findings parsers take the first
# findings they see, so the top of the file is the part that informs.
cap_log() {
  local f="$1"
  if [ -f "$f" ] && [ "$(wc -c < "$f")" -gt 200000 ]; then
    head -c 200000 "$f" > "$f.capped" && mv "$f.capped" "$f"
    echo "… log truncated at 200 kB" >> "$f"
  fi
}

# Source files the format phase reads, without build output or tool state.
java_files() {
  find . -name '*.java' -type f \
    -not -path '*/build/*' -not -path '*/target/*' -not -path '*/.*/*' -print0
}

# ── Format ──────────────────────────────────────────────────────────────
format=skipped

if [ "$KOTLIN_SOURCES" = "true" ]; then
  if [ "$OWNS_KTLINT" = "true" ]; then
    echo "::notice title=JVM Quality::the build applies its own ktlint, so it runs in the build phase"
  else
    echo "=== ktlint ===" | tee -a "$LINT_LOG"
    # ktlint reads .editorconfig, so a repository's own settings win.
    "$TOOLS_JAVA_BIN" -jar "$TOOLS_DIR/ktlint" --reporter=plain \
      '**/*.kt' '**/*.kts' '!**/build/**' 2>&1 | tee -a "$LINT_LOG"
    if [ "${PIPESTATUS[0]}" -ne 0 ]; then format=failed; else format=passed; fi
  fi
fi

if [ "$JAVA_SOURCES" = "true" ]; then
  if [ "$OWNS_JAVA_FORMAT" = "true" ]; then
    echo "::notice title=JVM Quality::the build formats Java with Spotless, so spotlessCheck runs in the build phase"
  else
    echo "=== google-java-format ===" | tee -a "$LINT_LOG"
    # --dry-run prints each file that would change. The findings parser
    # reads "would reformat <file>", the same line black prints.
    changed=$(java_files | xargs -0 "$TOOLS_JAVA_BIN" -jar "$TOOLS_DIR/google-java-format.jar" --dry-run 2>&1)
    gjf_status=$?
    if [ -n "$changed" ]; then
      while IFS= read -r line; do
        case "$line" in
          *.java) echo "would reformat $PWD/${line#./}" ;;
          *) echo "$line" ;;
        esac
      done <<< "$changed" | tee -a "$LINT_LOG"
    fi
    if [ "$gjf_status" -ne 0 ] || [ -n "$changed" ]; then
      format=failed
    elif [ "$format" = "skipped" ]; then
      format=passed
    fi
  fi
fi

# ── Static analysis ─────────────────────────────────────────────────────
analysis=skipped

if [ "$KOTLIN_SOURCES" = "true" ]; then
  if [ "$OWNS_DETEKT" = "true" ]; then
    echo "::notice title=JVM Quality::the build applies its own detekt, so it runs in the build phase"
  else
    echo "=== detekt ===" | tee -a "$LINT_LOG"
    # The default rules with maxIssues 0, overridden by the repository's
    # own detekt.yml when it has one.
    detekt_args=(--input . --excludes '**/build/**,**/.gradle/**' --build-upon-default-config)
    if [ -n "$DETEKT_CONFIG" ]; then
      detekt_args+=(--config "$DETEKT_CONFIG")
      echo "::notice title=JVM Quality::detekt reads $DETEKT_CONFIG on top of its defaults"
    fi
    "$TOOLS_JAVA_BIN" -jar "$TOOLS_DIR/detekt-cli-all.jar" "${detekt_args[@]}" 2>&1 | tee -a "$LINT_LOG"
    if [ "${PIPESTATUS[0]}" -ne 0 ]; then analysis=failed; else analysis=passed; fi
  fi
fi

if [ "$JAVA_SOURCES" = "true" ]; then
  # Error Prone runs inside javac, so it can only run from the project's
  # own build. docs/kb/jvm.md has the snippets to add it.
  echo "::notice title=JVM Quality::Java static analysis (Error Prone, NullAway) runs only when the build applies it. See docs/kb/jvm.md"
fi

cap_log "$LINT_LOG"

# ── Build and test ──────────────────────────────────────────────────────
build=failed

case "$BUILD_TOOL" in
  gradle)
    if [ -x ./gradlew ]; then
      gradle_cmd=(./gradlew)
    elif command -v gradle >/dev/null 2>&1; then
      echo "::warning title=JVM Quality::no Gradle wrapper (gradlew) in the project, using the gradle on PATH: $(command -v gradle)"
      gradle_cmd=(gradle)
    else
      gradle_cmd=()
      echo "::error title=JVM Quality::no Gradle wrapper (gradlew) in the project and no gradle on PATH. Commit the wrapper with 'gradle wrapper'."
    fi
    if [ "${#gradle_cmd[@]}" -gt 0 ]; then
      # --continue runs every module's tests even when one fails.
      # ciCoverage comes from the init script and writes the coverage XML.
      read -ra verify_tasks <<< "$GRADLE_VERIFY_TASKS"
      read -ra extra <<< "$EXTRA_ARGS"
      "${gradle_cmd[@]}" --console=plain --continue \
        --init-script "$ACTION_PATH/coverage.init.gradle" \
        build ciCoverage ${verify_tasks[@]+"${verify_tasks[@]}"} \
        ${extra[@]+"${extra[@]}"} 2>&1 | tee "$BUILD_LOG"
      if [ "${PIPESTATUS[0]}" -eq 0 ]; then build=passed; fi
    fi
    ;;
  maven)
    if [ -x ./mvnw ]; then
      maven_cmd=(./mvnw)
    elif command -v mvn >/dev/null 2>&1; then
      maven_cmd=(mvn)
    else
      maven_cmd=()
      echo "::error title=JVM Quality::no Maven wrapper (mvnw) in the project and no mvn on PATH"
    fi
    if [ "${#maven_cmd[@]}" -gt 0 ]; then
      # JaCoCo's agent and report goals are named on the command line, so
      # a pom that does not configure JaCoCo still reports coverage. -fae
      # builds every module before reporting failure.
      read -ra extra <<< "$EXTRA_ARGS"
      jacoco="org.jacoco:jacoco-maven-plugin:${JACOCO_VERSION}"
      "${maven_cmd[@]}" -B -ntp -fae \
        "$jacoco:prepare-agent" verify "$jacoco:report" \
        ${extra[@]+"${extra[@]}"} 2>&1 | tee "$BUILD_LOG"
      if [ "${PIPESTATUS[0]}" -eq 0 ]; then build=passed; fi
    fi
    ;;
  *)
    echo "::error title=JVM Quality::unknown build tool '$BUILD_TOOL'. Expected gradle or maven."
    ;;
esac

cap_log "$BUILD_LOG"

# ── Report paths ────────────────────────────────────────────────────────
# Absolute paths, one per line, so later steps can run from anywhere.
junit_dirs=$(find . -type d \( -path '*/build/test-results' \
  -o -path '*/target/surefire-reports' -o -path '*/target/failsafe-reports' \) \
  -not -path '*/.*/*' | sed "s|^\./|$PWD/|; s|^\.$|$PWD|" | sort)

if [ "$BUILD_TOOL" = "gradle" ] && [ -f build/reports/kover/report.xml ]; then
  # A root Kover report merges the modules it lists. Adding the module
  # reports to it would count their lines twice.
  coverage_files="$PWD/build/reports/kover/report.xml"
else
  coverage_files=$(find . -type f \( -path '*/build/reports/kover/report.xml' \
    -o -path '*/build/reports/jacoco/test/jacocoTestReport.xml' \
    -o -path '*/target/site/jacoco/jacoco.xml' \) \
    -not -path '*/.*/*' | sed "s|^\./|$PWD/|" | sort)
fi

{
  echo 'junit-paths<<JUNIT_EOF'
  [ -n "$junit_dirs" ] && echo "$junit_dirs"
  echo 'JUNIT_EOF'
  echo 'coverage-paths<<COVERAGE_EOF'
  [ -n "$coverage_files" ] && echo "$coverage_files"
  echo 'COVERAGE_EOF'
} >> "$GITHUB_OUTPUT"

# ── Coverage floor ──────────────────────────────────────────────────────
coverage=skipped
percent=""
check_out="$(mktemp)"

if [ "$OWNS_COVERAGE_FLOOR" = "true" ]; then
  # The build's own rule ran in the build phase. Still read the number.
  GITHUB_OUTPUT="$check_out" node "$ACTION_PATH/dist/coverage-check.js" \
    --reports "$coverage_files" --threshold 0 >/dev/null 2>&1
  echo "::notice title=JVM Quality::the build declares its own coverage rule, so the ${COVERAGE_THRESHOLD}% default floor is not applied"
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
output format-result "$format"
output analysis-result "$analysis"
output build-result "$build"
output coverage-result "$coverage"
output coverage-percent "$percent"
output lint-log "$LINT_LOG"
output build-log "$BUILD_LOG"

{
  echo "### JVM Quality"
  echo ""
  echo "| Phase | Result |"
  echo "| ----- | ------ |"
  echo "| Format | $format |"
  echo "| Static analysis | $analysis |"
  echo "| Build and test | $build |"
  echo "| Coverage floor (${COVERAGE_THRESHOLD}%) | $coverage${percent:+ ($percent%)} |"
} >> "$GITHUB_STEP_SUMMARY"

if [ "$format" = "failed" ]; then
  echo "::error title=JVM Quality::format check failed. Run ktlint --format or google-java-format --replace, see lint.log"
fi
if [ "$analysis" = "failed" ]; then
  echo "::error title=JVM Quality::detekt reported issues, see lint.log"
fi
if [ "$build" = "failed" ]; then
  echo "::error title=JVM Quality::the $BUILD_TOOL build or its tests failed, see build.log"
fi

for r in "$format" "$analysis" "$build" "$coverage"; do
  if [ "$r" = "failed" ]; then EXIT=1; fi
done
exit "$EXIT"
