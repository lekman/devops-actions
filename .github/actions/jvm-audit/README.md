# jvm-audit

Checks a Gradle or Maven project's resolved dependencies against the OSV
advisory database with OSV-Scanner, and writes a findings file in the same
shape `python-audit` writes for the Security Gate.

```yaml
- id: audit
  uses: lekman/devops-actions/.github/actions/jvm-audit@<sha>
  with:
    build-tool: ${{ needs.detect.outputs.jvm-build-tool }}
    java-version: ${{ needs.detect.outputs.jvm-version }}
    out-path: ${{ runner.temp }}/findings/jvm-audit.md
```

## Inputs

| Input                   | Default | Meaning                                             |
| ----------------------- | ------- | --------------------------------------------------- |
| `build-tool`            |         | Required. `gradle` or `maven`                       |
| `java-version`          | `17`    | Java version Gradle runs on to resolve dependencies |
| `working-directory`     | `.`     | Project directory                                   |
| `out-path`              |         | Required. Absolute path of the findings markdown    |
| `fail-on-vulnerability` | `false` | Fail the step when advisories are found             |
| `fail-on-indeterminate` | `true`  | Fail the step when the audit could not run          |

## Outputs

| Output                | Values                                 |
| --------------------- | -------------------------------------- |
| `status`              | `clean`, `vulnerable`, `indeterminate` |
| `osv-scanner-version` | e.g. `2.7.1`                           |

## Why OSV-Scanner

- It needs no account, API key or token, so it runs the same in a public
  repository, a fork and a private one.
- It reads both build tools: Gradle lockfiles, and Maven poms with their
  transitive dependencies resolved.
- It is one static binary for Linux and macOS, on x64 and ARM64, so it runs
  on GitHub-hosted and self-hosted runners alike. OWASP Dependency-Check,
  the usual alternative, builds a local copy of the NVD database first,
  and NVD rate-limits that download for clients without an API key.
- Its JSON names the advisory, its aliases, a CVSS score and the fixed
  versions, which is what the findings table shows.

Version 2.7.1 is downloaded from the GitHub release and checked against the
SHA-256 the release publishes in `osv-scanner_SHA256SUMS`
(`install-osv-scanner.sh`).

## Limits

- **Gradle without lockfiles.** OSV-Scanner reads lockfiles, not build
  scripts. When the build commits no `gradle.lockfile`, the action runs
  Gradle with `lock.init.gradle`, which turns on dependency locking and
  writes lockfiles into the checkout, so the versions audited are the ones
  Gradle resolves. Committed lockfiles are read as they are.
  Each `gradle.lockfile` is passed to OSV-Scanner by name, because its
  recursive scan skips files `.gitignore` lists, and a repository that
  ignores lockfiles would otherwise have them skipped.
- Only classpath configurations (compile, runtime, test) are audited, not
  build tooling such as the Kotlin compiler.
- A configuration that cannot resolve, for example from a private
  repository, is skipped with a warning naming it.
- A Maven dependency or parent pom found only in a private repository is
  not resolved.
- The fixed version shown is the nearest one above the version in use,
  read from the advisory's ranges.

An audit that could not run reports as indeterminate, never as a pass. See
[docs/kb/jvm.md](../../../docs/kb/jvm.md#dependency-audit).
