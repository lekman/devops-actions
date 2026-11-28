# Rust Projects

Covers how CI recognises a Cargo package or workspace, which checks it
runs, and what to change when a check does not behave the way you expect.

Read this if your repository holds a `Cargo.toml`, or if the
**rust-quality** or **rust-audit** job reported something surprising.

## What a Repository Needs

| File                                     | Why                                                                |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `Cargo.toml` in the project directory    | Marks the directory as Rust, a single package or a workspace       |
| `Cargo.lock`, committed                  | Every build runs with `--locked`, and the audit reads the lockfile |
| `rust-toolchain.toml`, or `rust` in mise | The toolchain CI installs. CI never picks a version for you        |

A minimal `rust-toolchain.toml`:

```toml
[toolchain]
channel = "1.100.0"
components = ["rustfmt", "clippy"]
profile = "minimal"
```

Or, in `mise.toml` or `.mise.toml`:

```toml
[tools]
rust = "1.100.0"
```

When both name a version, mise's wins, because mise prefers an explicit
config over `rust-toolchain.toml`. Keep the two the same.

## Which Checks Run

The `rust-quality` job runs three phases. Each runs even when an earlier
one fails, so one push shows every problem, and the job summary lists the
result of each.

| Phase  | Command                                                                |
| ------ | ---------------------------------------------------------------------- |
| Format | `cargo fmt --all --check`                                              |
| Lint   | `cargo clippy --workspace --all-targets --locked -- -D warnings`       |
| Test   | `cargo llvm-cov nextest --workspace --locked`, then `cargo test --doc` |

The test phase runs the tests once, through cargo-nextest under
cargo-llvm-cov, and writes two reports into the project directory (coverage only when the tests pass):

| Report               | Format    | Read by                                             |
| -------------------- | --------- | --------------------------------------------------- |
| `junit.xml`          | JUnit XML | the test report check and the quality gate summary  |
| `coverage/lcov.info` | LCOV      | the quality gate summary and later evidence tooling |

nextest does not run doctests, so `cargo test --doc` runs them afterwards
when the workspace has a library crate. Doctests are not in the coverage
numbers. There is no coverage floor, the same as for TypeScript and
Python.

## Configuring the Checks

The repository's own configuration wins:

- `rustfmt.toml` or `.rustfmt.toml` for formatting
- `clippy.toml`, and `[lints]` in `Cargo.toml`, for clippy
- `.config/nextest.toml` for the test runner. CI selects the nextest
  profile `devops-ci`, which sets `fail-fast = false` and the JUnit path;
  a `[profile.devops-ci]` in your own config overrides either.

## The Dependency Audit

The `rust-audit` job runs cargo-audit against `Cargo.lock` and the RustSec
advisory database. It needs no Rust toolchain and builds nothing.

| Result        | Meaning                                               | Job    |
| ------------- | ----------------------------------------------------- | ------ |
| clean         | no advisory matches a locked version                  | passes |
| vulnerable    | one or more advisories; the gate comment lists them   | passes |
| indeterminate | cargo-audit did not run, or its report was unreadable | fails  |

Every advisory counts, whatever its score, the same as pip-audit and
OSV-Scanner. Informational advisories (unmaintained, unsound, yanked) are
not counted.

## Caching

The cargo registry, git dependencies and the `target` directory are
cached with `actions/cache`, keyed on the runner, the compiler version and
`Cargo.lock`. A new lockfile restores the newest cache for the same
compiler, so only what changed is rebuilt. The toolchain itself is
downloaded on each run.

## Common Failures

| Symptom                                     | Cause and fix                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `no pinned Rust toolchain`                  | Add `rust-toolchain.toml` or `rust` under `[tools]` in mise                     |
| `the lock file ... needs to be updated`     | `Cargo.lock` is missing or stale. Run `cargo build` locally and commit the lock |
| Lint fails on a warning that passes locally | `-D warnings` turns every warning into an error. Fix it, or `#[allow]` it       |
| `cargo-nextest wrote no JUnit report`       | A `.config/nextest.toml` profile `devops-ci` removed the JUnit path             |
| Audit is indeterminate                      | The advisory database could not be fetched; the log shows cargo-audit's error   |
