# jvm-quality

Format check, static analysis, build and tests, and a line coverage floor
for a Gradle or Maven project, Kotlin or Java. Every phase runs even when
an earlier one fails, each phase's result is an output, and the step fails
at the end if any phase failed.

```yaml
- uses: actions/checkout@<sha>
- id: lang
  uses: lekman/devops-actions/.github/actions/detect-language@<sha>
- id: jvm
  if: steps.lang.outputs.has-jvm == 'true'
  uses: lekman/devops-actions/.github/actions/jvm-quality@<sha>
  with:
    build-tool: ${{ steps.lang.outputs.jvm-build-tool }}
    java-version: ${{ steps.lang.outputs.jvm-version }}
    findings-dir: ${{ runner.temp }}/findings-raw
- if: always() && steps.jvm.outcome != 'skipped'
  uses: lekman/devops-actions/.github/actions/findings-tests@<sha>
  with:
    junit-path: ${{ steps.jvm.outputs.junit-paths }}
    jacoco-path: ${{ steps.jvm.outputs.coverage-paths }}
    lint-log: ${{ steps.jvm.outputs.lint-log }}
    typecheck-log: ${{ steps.jvm.outputs.build-log }}
    out-path: ${{ runner.temp }}/findings/jvm-quality.md
```

## Inputs

| Input                | Default | Meaning                                                |
| -------------------- | ------- | ------------------------------------------------------ |
| `build-tool`         |         | Required. `gradle` or `maven`, from detect-language    |
| `java-version`       | `17`    | Java version to build with, installed as Temurin       |
| `working-directory`  | `.`     | Project directory                                      |
| `coverage-threshold` | `80`    | Minimum line coverage in percent                       |
| `build-args`         | `""`    | Extra Gradle or Maven arguments, separated by spaces   |
| `findings-dir`       |         | Required. Where `lint.log` and `build.log` are written |

## Outputs

| Output             | Values or shape                                               |
| ------------------ | ------------------------------------------------------------- |
| `format-result`    | `passed`, `failed`, `skipped`                                 |
| `analysis-result`  | `passed`, `failed`, `skipped`                                 |
| `build-result`     | `passed`, `failed` (the build, tests included)                |
| `coverage-result`  | `passed`, `failed` (below the floor or no report), `skipped`  |
| `coverage-percent` | e.g. `87.5`, empty when no report was found                   |
| `junit-paths`      | JUnit report folders, absolute, one per line                  |
| `coverage-paths`   | JaCoCo XML reports (JaCoCo or Kover), absolute, one per line  |
| `lint-log`         | Path of the format and static analysis log                    |
| `build-log`        | Path of the Gradle or Maven log                               |
| `tool-versions`    | e.g. `ktlint 1.8.0, detekt 1.23.8, google-java-format 1.37.0` |

## Phases and Defaults

| Phase           | Kotlin                                                            | Java                                  |
| --------------- | ----------------------------------------------------------------- | ------------------------------------- |
| Format          | ktlint 1.8.0, official code style, check mode                     | google-java-format 1.37.0, check mode |
| Static analysis | detekt 1.23.8, `--build-upon-default-config`, any issue fails     | Error Prone, only through your build  |
| Build and test  | `./gradlew build --continue` or `mvn -fae verify`                 | same                                  |
| Coverage floor  | line coverage from Kover or JaCoCo, at least `coverage-threshold` | line coverage from JaCoCo             |

Coverage needs no change to the build. A Gradle project that applies Kover
gets `koverXmlReport`. Any other Gradle project with the `java` plugin
(which Kotlin JVM applies) gets JaCoCo 0.8.16 from an init script
(`coverage.init.gradle`). A Maven project gets JaCoCo 0.8.16's
`prepare-agent` and `report` goals on the command line.

### Tool Versions and Pinning

| Tool                        | Version | Pinned how                                                                            |
| --------------------------- | ------- | ------------------------------------------------------------------------------------- |
| ktlint                      | 1.8.0   | Download, SHA-256 from GitHub's release asset digest (`fetch-tools.sh`)               |
| detekt-cli                  | 1.23.8  | Download from Maven Central, SHA-256 from its published `.sha256`                     |
| google-java-format          | 1.37.0  | Download, SHA-256 from GitHub's release asset digest                                  |
| JaCoCo                      | 0.8.16  | Version in `coverage.init.gradle` and `action.yml`, resolved by the build             |
| actions/setup-java          | v6.2.0  | Commit SHA                                                                            |
| gradle/actions/setup-gradle | v6.4.1  | Commit SHA. Basic cache provider; wrapper jars are checked against Gradle's checksums |
| actions/cache               | v6.1.0  | Commit SHA. Caches the three downloads, which are checked again after restore         |

The standalone tools run on a JDK 21 installed beside the project's JDK,
because google-java-format 1.37 needs 21 or newer.

## Your Configuration Wins

| You Have                                                      | What Happens                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `.editorconfig`                                               | ktlint reads it                                                                |
| `detekt.yml`, `config/detekt/detekt.yml`, `config/detekt.yml` | detekt reads it on top of its defaults                                         |
| ktlint Gradle plugin, kotlinter, or Spotless with ktlint      | standalone ktlint is skipped; your plugin runs in the build                    |
| detekt Gradle or Maven plugin                                 | standalone detekt is skipped                                                   |
| Spotless with a Java formatter                                | google-java-format is skipped; `spotlessCheck` runs                            |
| Kover `minBound`, or a JaCoCo violation rule                  | the floor is skipped; `koverVerify` or `jacocoTestCoverageVerification` is run |
| JaCoCo Maven plugin with the `check` goal                     | the floor is skipped; your rule runs in `verify`                               |

Error Prone and NullAway run inside `javac`, so they run only when your
build applies them. [docs/kb/jvm.md](../../../docs/kb/jvm.md#what-your-build-must-add)
has Gradle (Kotlin DSL) and Maven snippets for the full standard, checked
against this repository's fixtures.
