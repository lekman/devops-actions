# rust-quality

Format check, clippy and the tests for a Cargo package or workspace, with
JUnit XML and LCOV coverage for the quality gate and for evidence.

```yaml
- uses: actions/checkout@<sha>
- id: lang
  uses: lekman/devops-actions/.github/actions/detect-language@<sha>
- id: rust
  if: steps.lang.outputs.has-rust == 'true'
  uses: lekman/devops-actions/.github/actions/rust-quality@<sha>
  with:
    toolchain-source: ${{ steps.lang.outputs.rust-toolchain-source }}
    findings-dir: ${{ runner.temp }}/findings-raw
- uses: lekman/devops-actions/.github/actions/findings-tests@<sha>
  if: always()
  with:
    junit-path: ${{ steps.rust.outputs.junit-path }}
    lcov-path: ${{ steps.rust.outputs.lcov-path }}
    coverage-xml-path: ""
    lint-log: ${{ steps.rust.outputs.lint-log }}
    out-path: ${{ runner.temp }}/findings/rust-quality.md
```

## What It Needs

- `Cargo.toml` in `working-directory`, and `Cargo.lock` beside it. Every
  cargo call passes `--locked`.
- A pinned toolchain: `rust-toolchain.toml` (or `rust-toolchain`), or
  `rust` under `[tools]` in a mise config. The step fails without one.

## Phases

| Phase  | Command                                                                | Output          |
| ------ | ---------------------------------------------------------------------- | --------------- |
| Format | `cargo fmt --all --check`                                              | `format-result` |
| Lint   | `cargo clippy --workspace --all-targets --locked -- -D warnings`       | `lint-result`   |
| Test   | `cargo llvm-cov nextest --workspace --locked`, then `cargo test --doc` | `test-result`   |

Each phase runs even when an earlier one fails, and the step fails at the
end if any did. The test phase writes `junit.xml` and
`coverage/lcov.info` into `working-directory`. When cargo-nextest or
cargo-llvm-cov is missing it falls back to `cargo test` with a warning and
writes neither report.

## Pinned Tools

| Tool           | Version | Installed by                                          |
| -------------- | ------- | ----------------------------------------------------- |
| Rust toolchain | yours   | `jdx/mise-action` v5.2.8, then `rustup component add` |
| cargo-nextest  | 0.9.152 | `taiki-e/install-action` v2.90.5, checksum checked    |
| cargo-llvm-cov | 0.9.1   | `taiki-e/install-action` v2.90.5, checksum checked    |

`rustfmt`, `clippy` and `llvm-tools-preview` are added to the pinned
toolchain whether `rust-toolchain.toml` lists them or not.

## nextest Profile

The test phase selects the nextest profile `devops-ci` from
[nextest.toml](nextest.toml), passed with `--tool-config-file`. A
repository's own `.config/nextest.toml` overrides every value there,
including a `[profile.devops-ci]` of its own.

## Cache

`actions/cache` keeps the cargo registry, git dependencies and the target
directory, keyed on the runner, the `rustc` version and `Cargo.lock`. Set
`cache: "false"` to build from cold.
