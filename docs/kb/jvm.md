# JVM Projects

Covers how CI recognises a Kotlin or Java project built with Gradle or
Maven, which checks it runs, and what to change when a check does not
behave the way you expect.

Read this if your repository holds a `build.gradle(.kts)`,
`settings.gradle(.kts)` or `pom.xml`, or if the **jvm-quality** or
**jvm-audit** job reported something surprising.

## What CI Detects

The `detect-language` action reads the project directory and reports what
it finds.

| Signal                                               | What It Sets                                      |
| ---------------------------------------------------- | ------------------------------------------------- |
| `settings.gradle(.kts)` or `build.gradle(.kts)`      | JVM project, built with Gradle                    |
| `pom.xml`, and no Gradle file                        | JVM project, built with Maven                     |
| `.kt` sources below the directory                    | `kotlin` in `languages`                           |
| `.java` sources below the directory                  | `java` in `languages`                             |
| `.java-version`                                      | Java version                                      |
| `java` in `.tool-versions`                           | Java version, when there is no `.java-version`    |
| `[tools] java` in `mise.toml` or `.mise.toml`        | Java version, when neither file above is there    |
| `jvmToolchain(21)` or `JavaLanguageVersion.of(21)`   | Java version, read from the Gradle build script   |
| `maven.compiler.release` or `<release>` in `pom.xml` | Java version, read from the Maven build           |
| none of the above                                    | Java 17, and `jvm-version-source` reads `default` |

Only the feature release is kept, so `temurin-21.0.5+11` reads as `21`. CI
installs Temurin, and a patch level from another vendor names a build
Temurin does not publish.

## Which Checks Run

The `jvm-quality` job runs four phases. Each runs even when an earlier one
fails, so one push shows every problem, and the job summary lists the
result of each.

| Phase           | Kotlin                                     | Java                                      |
| --------------- | ------------------------------------------ | ----------------------------------------- |
| Format          | ktlint, official code style, check mode    | google-java-format, check mode            |
| Static analysis | detekt with its default rules, maxIssues 0 | Error Prone and NullAway, from your build |
| Build and test  | `./gradlew build` or `mvn verify`          | `./gradlew build` or `mvn verify`         |
| Coverage floor  | 80% of lines, from Kover or JaCoCo         | 80% of lines, from JaCoCo                 |

ktlint, detekt and google-java-format run as standalone tools. They need no
change to your build, the same way the Python checks run ruff and mypy.
Each is downloaded at a pinned version and checked against a SHA-256 before
it runs.

| Tool               | Version | Checked against                                 |
| ------------------ | ------- | ----------------------------------------------- |
| ktlint             | 1.8.0   | the digest GitHub records for the release asset |
| detekt-cli         | 1.23.8  | the `.sha256` Maven Central publishes beside it |
| google-java-format | 1.37.0  | the digest GitHub records for the release asset |
| JaCoCo             | 0.8.16  | Maven Central, through Gradle or Maven          |

The tools run on a JDK 21 installed beside your project's JDK, because
google-java-format 1.37 needs 21 or newer. Your build still runs on the
version detection found.

### Coverage

A build that applies Kover gets its XML report from `koverXmlReport`. Any
other build with the `java` plugin, which the Kotlin JVM plugin applies
too, gets JaCoCo through a Gradle init script, with no change to the build.
A Maven build gets JaCoCo's agent and report goals on the command line.

The floor is 80% of lines across all modules. The gate comment shows the
same number.

## Your Configuration Wins

The defaults are for repositories that configure none of their own. When
yours does, CI uses yours.

| You Have                                                     | What CI Does                                              |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| `.editorconfig`                                              | ktlint reads it, for example to change the code style     |
| `detekt.yml` (or `config/detekt/detekt.yml`)                 | detekt reads it on top of its defaults                    |
| the ktlint Gradle plugin, kotlinter, or Spotless with ktlint | standalone ktlint is skipped; your plugin runs in `check` |
| the detekt Gradle or Maven plugin                            | standalone detekt is skipped; your plugin runs in `check` |
| Spotless with a Java formatter                               | google-java-format is skipped; `spotlessCheck` runs       |
| a Kover `minBound`, or a JaCoCo violation rule               | the 80% floor is skipped; your rule runs instead          |
| the JaCoCo Maven plugin's `check` goal                       | the 80% floor is skipped; your rule runs in `verify`      |

Detection reads your build files as text: plugin ids, version catalog
entries and Maven artifact ids. A plugin applied some other way, for
example by a convention plugin published elsewhere, is not seen, and the
default runs as well. That can only add a check.

## What Your Build Must Add

Error Prone runs inside `javac`, so it cannot run from outside your build.
It also needs JDK 21 or newer since version 2.43. Add it, with NullAway if
you want null checking, and the build phase fails on its findings. A
Spotless setup and a coverage rule are optional, because CI applies its
defaults for those without them.

### Gradle (Kotlin DSL)

Checked with Gradle 9.9.1.

```kotlin
import net.ltgt.gradle.errorprone.errorprone

plugins {
    java
    jacoco
    id("com.diffplug.spotless") version "8.9.0"
    id("net.ltgt.errorprone") version "5.1.1"
}

java {
    // Error Prone 2.43 and later run only on JDK 21 or newer.
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

dependencies {
    // NullAway checks packages marked @NullMarked.
    implementation("org.jspecify:jspecify:1.0.0")
    errorprone("com.google.errorprone:error_prone_core:2.51.0")
    errorprone("com.uber.nullaway:nullaway:0.14.3")
}

spotless {
    java {
        googleJavaFormat()
    }
}

tasks.withType<JavaCompile>().configureEach {
    // A warning fails the build, Error Prone's included.
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
    options.errorprone {
        error("NullAway")
        option("NullAway:OnlyNullMarked", "true")
    }
}

tasks.test {
    finalizedBy(tasks.jacocoTestReport)
}

tasks.jacocoTestReport {
    reports { xml.required = true }
}

tasks.jacocoTestCoverageVerification {
    violationRules {
        rule {
            limit {
                counter = "LINE"
                minimum = "0.80".toBigDecimal()
            }
        }
    }
}

tasks.check {
    dependsOn(tasks.jacocoTestCoverageVerification)
}
```

For Kotlin, a coverage rule with Kover looks like this. `koverVerify` runs
as part of `check`.

```kotlin
plugins {
    id("org.jetbrains.kotlinx.kover") version "0.9.11"
}

kover {
    reports {
        verify {
            rule {
                minBound(80)
            }
        }
    }
}
```

### Maven

Checked with Maven 3.9.16. The `test-fixtures/jvm-maven` project in this
repository uses exactly this setup.

```xml
<properties>
  <!-- Error Prone 2.43 and later run only on JDK 21 or newer. -->
  <maven.compiler.release>21</maven.compiler.release>
  <error-prone.version>2.51.0</error-prone.version>
  <nullaway.version>0.14.3</nullaway.version>
</properties>

<dependencies>
  <!-- NullAway checks packages marked @NullMarked. -->
  <dependency>
    <groupId>org.jspecify</groupId>
    <artifactId>jspecify</artifactId>
    <version>1.0.0</version>
  </dependency>
</dependencies>

<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-compiler-plugin</artifactId>
      <version>3.16.0</version>
      <configuration>
        <!-- A warning fails the build, Error Prone's included. -->
        <failOnWarning>true</failOnWarning>
        <compilerArgs>
          <arg>-Xlint:all</arg>
          <arg>-XDcompilePolicy=simple</arg>
          <arg>--should-stop=ifError=FLOW</arg>
          <arg>-Xplugin:ErrorProne -XepOpt:NullAway:OnlyNullMarked=true -Xep:NullAway:ERROR</arg>
          <arg>-XDaddTypeAnnotationsToSymbol=true</arg>
        </compilerArgs>
        <annotationProcessorPaths>
          <path>
            <groupId>com.google.errorprone</groupId>
            <artifactId>error_prone_core</artifactId>
            <version>${error-prone.version}</version>
          </path>
          <path>
            <groupId>com.uber.nullaway</groupId>
            <artifactId>nullaway</artifactId>
            <version>${nullaway.version}</version>
          </path>
        </annotationProcessorPaths>
      </configuration>
    </plugin>
  </plugins>
</build>
```

Error Prone also needs these lines in `.mvn/jvm.config`, because it uses
compiler internals that the JDK hides by default:

```text
--add-exports jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED
--add-exports jdk.compiler/com.sun.tools.javac.file=ALL-UNNAMED
--add-exports jdk.compiler/com.sun.tools.javac.main=ALL-UNNAMED
--add-exports jdk.compiler/com.sun.tools.javac.model=ALL-UNNAMED
--add-exports jdk.compiler/com.sun.tools.javac.parser=ALL-UNNAMED
--add-exports jdk.compiler/com.sun.tools.javac.processing=ALL-UNNAMED
--add-exports jdk.compiler/com.sun.tools.javac.tree=ALL-UNNAMED
--add-exports jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED
--add-opens jdk.compiler/com.sun.tools.javac.code=ALL-UNNAMED
--add-opens jdk.compiler/com.sun.tools.javac.comp=ALL-UNNAMED
```

Mark each package for NullAway with a `package-info.java`:

```java
@NullMarked
package com.acme.greeter;

import org.jspecify.annotations.NullMarked;
```

## Dependency Audit

The `jvm-audit` job checks your resolved dependencies against the OSV
advisory database with OSV-Scanner 2.7.1, and reports advisories in the
Security Gate in the same table the Python audit uses.

OSV-Scanner needs no account or API key, runs as a single binary on Linux
and macOS runners (checked against the release's published SHA-256), and
reads both build tools:

| Build Tool | What Is Read                                                              |
| ---------- | ------------------------------------------------------------------------- |
| Gradle     | `gradle.lockfile` files. CI writes them first when the build commits none |
| Maven      | `pom.xml`, with OSV-Scanner resolving the transitive dependencies itself  |

A build script names version ranges, platforms and plugins that only
Gradle can resolve, so OSV-Scanner reads lockfiles instead. When your build
commits none, CI runs Gradle with an init script that turns on dependency
locking for every project and writes the lockfiles, so the audit reads
exactly the versions Gradle resolves. Committed lockfiles are read as they
are.

Limits:

- Only classpath configurations are locked and audited: compile, runtime
  and test classpaths. Build tooling, such as the Kotlin compiler, is not.
- A configuration that cannot resolve, for example from a private
  repository CI cannot reach, is skipped with a warning naming it.
- OSV-Scanner resolves a pom from Maven Central. A dependency or parent
  pom only in a private repository is not resolved.
- Fixed versions come from the advisory's ranges. The table shows the
  nearest fixed version above the one you use.

Advisories do not fail the job. An audit that could not run does, for the
reason given in [Python Projects](python.md#why-an-incomplete-audit-fails-the-job).

## Common Failures

| Symptom                                                        | Cause                                                                   | Fix                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Format fails with ktlint findings                              | Code differs from the Kotlin code style                                 | Run `ktlint --format`, or set rules in `.editorconfig`                                                 |
| Format fails with "would be reformatted by google-java-format" | Code differs from google-java-format's output                           | Run `google-java-format --replace` on the files, or apply Spotless and run `spotlessApply`             |
| Static analysis fails with detekt findings                     | detekt's default rules, with any issue failing                          | Fix the code, or add a `detekt.yml` that changes the rules you disagree with                           |
| Build fails with `error: [CheckName]`                          | Error Prone or NullAway found a problem                                 | Read the check's page at `errorprone.info/bugpattern/<CheckName>`                                      |
| Coverage fails with "no coverage report"                       | Tests did not run, or the build wrote no JaCoCo or Kover XML            | Check the build log. A Surefire `argLine` that drops `@{argLine}` removes JaCoCo's agent               |
| Coverage fails below 80%                                       | Tests do not reach enough of the code                                   | Add tests, or declare your own coverage rule (see above) if your project needs a different number      |
| Build fails with "release version 21 not supported"            | The project asks for a newer Java than detection found                  | Pin the version in `.java-version`, or with `jvmToolchain(21)` or `maven.compiler.release`             |
| "no Gradle wrapper"                                            | The repository does not commit `gradlew`                                | Run `gradle wrapper` and commit `gradlew`, `gradlew.bat` and `gradle/wrapper/`                         |
| Gradle wrapper validation fails                                | `gradle-wrapper.jar` does not match a published Gradle checksum         | Regenerate the wrapper with `gradle wrapper`                                                           |
| Audit reports "did not complete"                               | Gradle could not resolve the dependencies, or OSV-Scanner found nothing | Read the warning in the audit step. A private repository needs credentials the audit job does not have |

## Local Reproduction

```bash
# Format and static analysis, with the versions CI pins
ktlint '**/*.kt' '**/*.kts' '!**/build/**'
java -jar detekt-cli-1.23.8-all.jar --input . --build-upon-default-config
java -jar google-java-format-1.37.0-all-deps.jar --dry-run $(git ls-files '*.java')

# Build, test and coverage
./gradlew build
mvn verify

# Audit a Gradle build without lockfiles: lock, then scan
./gradlew dependencies --write-locks   # needs dependencyLocking in the build
osv-scanner scan source --recursive .
```

## Related Pages

- [Test Failures](tests.md) for how the gate reads JUnit XML
- [Lint Failures](lint.md) for the shared lint reporting
- [Security Scan Failures](security.md) for Semgrep's Java and Kotlin rules
- [Quality Gate](quality-gate.md) for how the pass and fail decision is made
