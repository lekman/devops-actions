# .NET Projects

Covers how CI recognises a C# project, which checks it runs, and what to
change when a check does not behave the way you expect.

Read this if your repository holds a `.sln`, `.slnx` or `.csproj`, or if
the **dotnet-quality** or **dotnet-audit** job reported something
surprising.

## What CI Detects

The `detect-language` action reads the project directory and reports what
it finds.

| Signal                                               | What It Sets                                         |
| ---------------------------------------------------- | ---------------------------------------------------- |
| a `.sln`, `.slnx`, `.csproj`, `.fsproj` or `.vbproj` | .NET project                                         |
| `.cs` sources below the directory                    | `csharp` in `languages`                              |
| `sdk.version` in the nearest `global.json`           | SDK version                                          |
| the newest `TargetFramework` or `TargetFrameworks`   | SDK version (`net10.0` gives `10.0.x`), with no file |
| `test.runner` is `Microsoft.Testing.Platform`        | Tests run on the Microsoft Testing Platform          |
| anything else                                        | Tests run on VSTest                                  |

The SDK reads the nearest `global.json` above a project, so one at the
repository root applies to a project in a subfolder, and CI reads it the
same way. Every target framework's channel is installed beside the SDK, so
a test project on an older framework finds its runtime.

## Which Checks Run

The `dotnet-quality` job runs these phases. Each runs even when an earlier
one fails, and the job summary lists the result of each.

| Phase          | Command                                                |
| -------------- | ------------------------------------------------------ |
| Restore        | `dotnet restore`                                       |
| Build          | `dotnet build`, with the strict defaults below         |
| Format         | `dotnet format --verify-no-changes`                    |
| Test           | `dotnet test`, with TRX results and Cobertura coverage |
| Coverage floor | 80% of lines                                           |

When there is one solution at the project directory, every command runs
against it. Otherwise CI builds a solution of all the projects it finds,
outside the checkout, for the run.

### The Strict Build

The build passes these MSBuild properties to every project, through
`CustomBeforeMicrosoftCommonProps`, and sets each one only when your
repository leaves it unset:

| Property                  | Default              | Effect                                                |
| ------------------------- | -------------------- | ----------------------------------------------------- |
| `TreatWarningsAsErrors`   | `true`               | A warning fails the build                             |
| `AnalysisLevel`           | `latest-recommended` | The recommended .NET analyzer rules run as warnings   |
| `EnforceCodeStyleInBuild` | `true`               | IDE style rules from `.editorconfig` run in the build |
| `Nullable`                | `enable`             | Nullable reference types are checked                  |

A value you set in `Directory.Build.props` or in a project file wins.

NuGet's own audit warnings (NU1901 to NU1904) stay warnings when CI is
what turned warnings into errors. Advisories belong to the `dotnet-audit`
job, and a new advisory against an unchanged dependency should not break
the build.

When the strict build fails, the tests still run: CI builds again without
warnings as errors so the test and coverage results are reported too.

### Formatting and .editorconfig

`dotnet format --verify-no-changes` checks whitespace, code style and
analyzer fixes, at the severities `.editorconfig` sets.

A repository with no `.editorconfig`, at the project directory or above it,
gets the action's default for the run
(`.github/actions/dotnet-quality/defaults/.editorconfig`). It sets the
formatting the .NET templates use, and a few style rules as warnings:
file-scoped namespaces, braces on every block, readonly fields, and no
unused private members. Commit your own `.editorconfig` to replace it. The
two are never merged.

### Tests and Coverage

| Test Platform              | Results                                   | Coverage                                                                     |
| -------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| VSTest                     | `--logger trx`                            | coverlet (`XPlat Code Coverage`) when referenced, else Microsoft's collector |
| Microsoft Testing Platform | `--report-trx`, else `--report-xunit-trx` | `Microsoft.Testing.Extensions.CodeCoverage`, else `coverlet.MTP`             |

On the Microsoft Testing Platform the options a test project offers depend
on the extensions it references, so CI asks the test applications with
`dotnet test --help` and uses what they offer. A project that references
no coverage extension fails the coverage phase with a message naming the
packages to add. xUnit.net v3 writes TRX itself, so it needs no TRX
extension.

Microsoft's VSTest collector ships in `Microsoft.NET.Test.Sdk`, which every
VSTest project references. By default it counts the test assembly as
covered code, so CI passes a run settings file that leaves it out, unless
your project names run settings of its own with `RunSettingsFilePath`.

CI converts the TRX results to JUnit XML (the `junit-path` output), which
the gate and test report check runs read. The floor is 80% of lines, merged
across test projects line by line, so a library two test projects both
exercise is not counted twice.

## Your Configuration Wins

| You Have                                            | What CI Does                                     |
| --------------------------------------------------- | ------------------------------------------------ |
| any of the four strict properties set               | your value is used                               |
| `.editorconfig`                                     | it replaces the default one                      |
| coverlet's `<Threshold>` in a project or props file | the 80% floor is skipped; your threshold applies |
| `RunSettingsFilePath`                               | CI passes no run settings of its own             |
| `global.json` with `sdk.version`                    | that SDK is installed                            |

## Dependency Audit

The `dotnet-audit` job runs the SDK's own package audit,
`dotnet package list --vulnerable --include-transitive --format json`
(`dotnet list package` on SDKs before 10), and reports advisories in the
Security Gate in the same table the Python audit uses.

It needs no extra tool, account or key: the SDK reads the advisory feed of
each package source, nuget.org's by default, and covers direct and
transitive packages. The SDK reports a severity and an advisory link for
each package but no fixed version, so the table says "not reported" in that
column.

Advisories do not fail the job. An audit that could not run does, for the
reason given in [Python Projects](python.md#why-an-incomplete-audit-fails-the-job).

## Common Failures

| Symptom                                                | Cause                                                                   | Fix                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Build fails with `error CA…` or `error IDE…`           | An analyzer or style rule raised a warning, and warnings fail the build | Fix the code, or change the rule's severity in `.editorconfig`                                   |
| Build fails with `error CS86…` nullable warnings       | Nullable reference types are on                                         | Fix the warnings, or set `<Nullable>` in your project if the codebase is not ready               |
| Format fails with `error WHITESPACE`                   | Code differs from the formatting `.editorconfig` asks for               | Run `dotnet format` and commit the result                                                        |
| Coverage fails with "references no coverage extension" | A Microsoft Testing Platform project has no coverage extension          | Reference `Microsoft.Testing.Extensions.CodeCoverage` (or `coverlet.MTP`) in the test project    |
| Coverage fails below 80%                               | Tests do not reach enough of the code                                   | Add tests, or set coverlet's `<Threshold>` if your project needs a different number              |
| Coverage looks higher than expected                    | Your own run settings include the test assembly                         | Set `<IncludeTestAssembly>false</IncludeTestAssembly>` in them                                   |
| No JUnit file                                          | The test projects offer no TRX report                                   | On the Microsoft Testing Platform, reference `Microsoft.Testing.Extensions.TrxReport`            |
| Audit reports "did not complete"                       | Restore failed, or the package listing reported a problem               | Read the warning in the audit step. A private feed needs credentials the audit job does not have |

## Local Reproduction

```bash
# The strict build: point CustomBeforeMicrosoftCommonProps at a copy of strict.props
dotnet build -p:CustomBeforeMicrosoftCommonProps=$PWD/strict.props

dotnet format --verify-no-changes

# VSTest
dotnet test --logger trx --collect "Code Coverage;Format=cobertura"

# Microsoft Testing Platform
dotnet test --report-trx --coverage --coverage-output-format cobertura

# Audit
dotnet package list --vulnerable --include-transitive
```

## Related Pages

- [Test Failures](tests.md) for how the gate reads JUnit XML
- [Lint Failures](lint.md) for the shared lint reporting
- [Security Scan Failures](security.md) for Semgrep's C# rules
- [Quality Gate](quality-gate.md) for how the pass and fail decision is made
