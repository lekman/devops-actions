# dotnet-audit

Checks a .NET solution's NuGet packages, direct and transitive, against the
package sources' advisory feeds with the SDK's own audit, and writes a
findings file in the same shape `python-audit` writes for the Security
Gate.

```yaml
- id: audit
  uses: lekman/devops-actions/.github/actions/dotnet-audit@<sha>
  with:
    dotnet-version: ${{ needs.detect.outputs.dotnet-version }}
    out-path: ${{ runner.temp }}/findings/dotnet-audit.md
```

## Inputs

| Input                   | Default | Meaning                                             |
| ----------------------- | ------- | --------------------------------------------------- |
| `dotnet-version`        | `""`    | SDK for setup-dotnet when there is no `global.json` |
| `working-directory`     | `.`     | Directory holding the solution or projects          |
| `out-path`              |         | Required. Absolute path of the findings markdown    |
| `fail-on-vulnerability` | `false` | Fail the step when advisories are found             |
| `fail-on-indeterminate` | `true`  | Fail the step when the audit could not run          |

## Outputs

| Output   | Values                                 |
| -------- | -------------------------------------- |
| `status` | `clean`, `vulnerable`, `indeterminate` |

## Why the SDK's Own Audit

`dotnet package list --vulnerable --include-transitive --format json`
(`dotnet list package` on SDKs before 10) ships with the SDK, so there is
nothing to download, and it reads the advisory feed of each configured
package source, nuget.org's by default, with no account or key. It covers
transitive packages, and it uses the same restore the build uses, so
private feeds work when the restore does.

The SDK reports a severity and an advisory link for each package, and no
fixed version. The findings table says "not reported" in that column,
rather than claiming no fix exists. The count of packages checked comes
from a second listing without `--vulnerable`.

The restore in this action turns NuGet's restore-time audit off, since the
listing reports the same advisories and a project that treats warnings as
errors would otherwise fail the restore on them.

An audit that could not run reports as indeterminate, never as a pass. See
[docs/kb/dotnet.md](../../../docs/kb/dotnet.md#dependency-audit).
