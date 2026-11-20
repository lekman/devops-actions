# detect-language

Reports which languages a repository declares, and the setup each one
needs: the Python package manager and phases, the JVM build tool and Java
version, and the .NET SDK version and test platform. Callers gate their
per-language steps and jobs on these outputs.

```yaml
- uses: actions/checkout@<sha>
- id: lang
  uses: lekman/devops-actions/.github/actions/detect-language@<sha>
  with:
    working-directory: .
```

## Outputs

| Output               | Example            | Meaning                                                                                 |
| -------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `languages`          | `node,kotlin`      | Detected languages, in the order node, python, java, kotlin, csharp                     |
| `has-node`           | `true`             | `package.json` at the root                                                              |
| `has-python`         | `false`            | `pyproject.toml` or `setup.py` at the root                                              |
| `python-*`           |                    | See `action.yml`. Unchanged by the JVM and .NET outputs                                 |
| `has-jvm`            | `true`             | `settings.gradle(.kts)`, `build.gradle(.kts)` or `pom.xml` at the root                  |
| `jvm-build-tool`     | `gradle`           | `gradle` or `maven`. Gradle wins when both are present                                  |
| `jvm-version`        | `21`               | Java feature release to build with                                                      |
| `jvm-version-source` | `build.gradle.kts` | Where `jvm-version` came from, or `default`                                             |
| `has-dotnet`         | `true`             | A `.sln`, `.slnx`, `.csproj`, `.fsproj` or `.vbproj` at or below the root               |
| `dotnet-version`     | `10.0.100`         | `global.json`'s `sdk.version`, else `<major>.<minor>.x` of the newest `TargetFramework` |
| `dotnet-test-runner` | `mtp`              | `mtp` when `global.json` opts in to the Microsoft Testing Platform, else `vstest`       |

`node` and `python` come from manifests at the root. `java`, `kotlin` and
`csharp` come from `.java`, `.kt` and `.cs` sources anywhere below it. A
Kotlin DSL build script (`.kts`) alone does not make a project Kotlin. The
walk skips build output and dependency folders (`build`, `target`, `bin`,
`obj`, `node_modules`, dot folders) and stops 10 levels down or after
50,000 files.

## Java Version

First match wins:

1. `.java-version`
2. a `java` line in `.tool-versions`
3. `[tools] java` in `mise.toml` or `.mise.toml`
4. the Gradle toolchain: `jvmToolchain(21)` or `JavaLanguageVersion.of(21)`
5. the Maven compiler release: `maven.compiler.release`, `<release>`,
   `maven.compiler.target`, `maven.compiler.source`, `java.version`
6. **Java 17**, when the project pins none. `jvm-version-source` then reads
   `default`, so a caller can tell a default from a pin.

Only the feature release is reported (`temurin-21.0.5+11` reads as `21`),
because the JVM actions install Temurin and a patch level from another
vendor names a build Temurin does not publish.

## .NET Version

The nearest `global.json` at the working directory or above it, up to the
checkout root, decides: its `sdk.version` is reported as written. Without
one, the newest `TargetFramework` or `TargetFrameworks` value across the
project files and `Directory.Build.props` gives the channel (`net10.0`
gives `10.0.x`). .NET Framework and .NET Standard targets name no SDK and
are skipped.
