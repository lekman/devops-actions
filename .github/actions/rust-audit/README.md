# rust-audit

Audits `Cargo.lock` against the RustSec advisory database with cargo-audit
and writes a findings file for the Security Gate, in the same shape as
`python-audit`, `jvm-audit` and `dotnet-audit`.

```yaml
- uses: actions/checkout@<sha>
- uses: lekman/devops-actions/.github/actions/rust-audit@<sha>
  with:
    out-path: ${{ runner.temp }}/findings/rust-audit.md
```

## What It Needs

A committed `Cargo.lock` in `working-directory`. cargo-audit reads the
lockfile only, so no Rust toolchain is installed and nothing is built.

## Results

| `status`        | Meaning                                               | Step                                         |
| --------------- | ----------------------------------------------------- | -------------------------------------------- |
| `clean`         | no advisory matches a locked version                  | passes                                       |
| `vulnerable`    | one or more advisories, listed in the findings file   | passes, unless `fail-on-vulnerability`       |
| `indeterminate` | cargo-audit did not run, or its report was unreadable | fails, unless `fail-on-indeterminate: false` |

Every advisory counts, whatever its CVSS score, the same as the other
audit actions. Informational advisories (unmaintained, unsound, yanked)
are warnings to cargo-audit and are not counted.

## Pinned Tools

cargo-audit 0.23.0, a prebuilt binary installed by
`taiki-e/install-action` v2.90.5, which checks it against the SHA-256 in
its manifest. The fallback that compiles it from source is turned off.
