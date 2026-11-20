# dotnet-quality

A strict build, a format check, tests with coverage, and a line coverage
floor for a .NET solution, on VSTest or the Microsoft Testing Platform.
Every phase runs even when an earlier one fails, each phase's result is an
output, and the step fails at the end if any phase failed.

```yaml
- uses: actions/checkout@<sha>
- id: lang
  uses: lekman/devops-actions/.github/actions/detect-language@<sha>
- id: dotnet
  if: steps.lang.outputs.has-dotnet == 'true'
  uses: lekman/devops-actions/.github/actions/dotnet-quality@<sha>
  with:
    dotnet-version: ${{ steps.lang.outputs.dotnet-version }}
    findings-dir: ${{ runner.temp }}/findings-raw
- if: always() && steps.dotnet.outcome != 'skipped'
  uses: lekman/devops-actions/.github/actions/findings-tests@<sha>
  with:
    junit-path: ${{ steps.dotnet.outputs.junit-path }}
    coverage-xml-path: ${{ steps.dotnet.outputs.coverage-paths }}
    lint-log: ${{ steps.dotnet.outputs.format-log }}
    typecheck-log: ${{ steps.dotnet.outputs.build-log }}
    out-path: ${{ runner.temp }}/findings/dotnet-quality.md
```

## Inputs

| Input                | Default | Meaning                                                                   |
| -------------------- | ------- | ------------------------------------------------------------------------- |
| `dotnet-version`     | `""`    | SDK for setup-dotnet when there is no `global.json`, from detect-language |
| `working-directory`  | `.`     | Directory holding the solution or projects                                |
| `coverage-threshold` | `80`    | Minimum line coverage in percent                                          |
| `build-args`         | `""`    | Extra arguments for `dotnet build` and `dotnet test`                      |
| `findings-dir`       |         | Required. Where `build.log`, `format.log` and `test.log` are written      |
| `results-dir`        | `""`    | Where TRX, JUnit and coverage go. Empty uses the runner's temp directory  |

## Outputs

| Output                                | Values or shape                                                     |
| ------------------------------------- | ------------------------------------------------------------------- |
| `restore-result`                      | `passed`, `failed`                                                  |
| `build-result`                        | `passed`, `failed` (compiler and analyzers, warnings as errors)     |
| `format-result`                       | `passed`, `failed`                                                  |
| `test-result`                         | `passed`, `failed`                                                  |
| `coverage-result`                     | `passed`, `failed` (below the floor or no report), `skipped`        |
| `coverage-percent`                    | e.g. `91.2`, empty when no report was found                         |
| `junit-path`                          | JUnit XML converted from the TRX results, empty when there was none |
| `coverage-paths`                      | Cobertura files, one per line                                       |
| `build-log`, `format-log`, `test-log` | Paths of the phase logs                                             |
| `test-runner`                         | `vstest` or `mtp`                                                   |

## Phases and Defaults

| Phase          | What runs                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restore        | `dotnet restore`                                                                                                                                        |
| Build          | `dotnet build` with `strict.props`: `TreatWarningsAsErrors=true`, `AnalysisLevel=latest-recommended`, `EnforceCodeStyleInBuild=true`, `Nullable=enable` |
| Format         | `dotnet format --verify-no-changes`: whitespace, style and analyzers                                                                                    |
| Test (VSTest)  | `dotnet test --logger trx --collect "<collector>"`                                                                                                      |
| Test (MTP)     | `dotnet test --report-trx` or `--report-xunit-trx`, with `--coverage` or `--coverlet`                                                                   |
| Coverage floor | line coverage across test projects, merged line by line, at least `coverage-threshold`                                                                  |

`strict.props` reaches every project through
`-p:CustomBeforeMicrosoftCommonProps`. MSBuild imports it after the
repository's `Directory.Build.props` and before the project file, and it
sets each property only when it is still empty.

A repository with no `.editorconfig` gets `defaults/.editorconfig` for the
run: the .NET template formatting and a few style rules as warnings.

VSTest coverage uses coverlet's `XPlat Code Coverage` when a test project
references `coverlet.collector`, and Microsoft's collector from
`Microsoft.NET.Test.Sdk` otherwise, with `coverage.runsettings` to leave the
test assembly out. On the Microsoft Testing Platform the action asks the
test applications which options they offer; a project needs
`Microsoft.Testing.Extensions.CodeCoverage` or `coverlet.MTP` for coverage.

When the strict build fails, the tests still run on a build without
warnings as errors, so the test and coverage results are reported as well.

### Versions and Pinning

| Component                  | Version            | Pinned how                                          |
| -------------------------- | ------------------ | --------------------------------------------------- |
| actions/setup-dotnet       | v6.1.0             | Commit SHA                                          |
| .NET SDK                   |                    | The repository's `global.json`, or `dotnet-version` |
| Analyzers, `dotnet format` | ships with the SDK | Follows the SDK                                     |
| Coverage collector         |                    | The package the test project references             |

No tool is downloaded beyond the SDK and the project's own packages.

## Your Configuration Wins

| You Have                                          | What Happens                                 |
| ------------------------------------------------- | -------------------------------------------- |
| any of the four strict properties set             | your value is used                           |
| `.editorconfig` at the project directory or above | it replaces the default                      |
| coverlet's `<Threshold>`                          | the floor is skipped; your threshold applies |
| `RunSettingsFilePath`                             | the action passes no run settings of its own |

See [docs/kb/dotnet.md](../../../docs/kb/dotnet.md).
