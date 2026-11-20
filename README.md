# devops-actions

Composite GitHub Actions for CI: change detection, quality and security
checks, test and security findings, and a quality gate that posts one sticky
pull request comment. Each action runs on its own; there are no shared
workflows to call and no token to mint.

## Use

Call an action directly from a job, pinned to a commit SHA:

```yaml
- uses: lekman/devops-actions/.github/actions/security@<sha> # main
  with:
    semgrep-json-output: ${{ runner.temp }}/semgrep-results.json
```

Each action's `action.yml` lists its inputs, outputs and what it needs before
it runs (usually a checkout). The JVM and .NET actions, and
`detect-language`, also have a `README.md` beside their `action.yml`.

## Actions

| Action               | What it does                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `branch-maintenance` | Finds stale or conflicted pull request branches, then updates them or comments                     |
| `change-detection`   | Detects file changes with configurable path filters                                                |
| `detect-language`    | Detects the languages a repository declares, its Python, JVM and .NET setup                        |
| `dotnet-audit`       | Runs the .NET SDK's package audit and writes a findings file                                       |
| `dotnet-quality`     | Builds with analyzers and warnings as errors, checks formatting, tests with an 80% coverage floor  |
| `drift-matrix`       | Lists release-please versions missing from the package registry, as a matrix                       |
| `findings-security`  | Turns Semgrep JSON into a summary table for the quality gate comment                               |
| `findings-tests`     | Turns JUnit XML and LCOV, Cobertura or JaCoCo coverage into a summary for the quality gate comment |
| `function-publish`   | Publishes a Python Azure Functions project to a Flex Consumption app                               |
| `jvm-audit`          | Runs OSV-Scanner on a Gradle or Maven project and writes a findings file                           |
| `jvm-quality`        | ktlint, detekt, google-java-format, the Gradle or Maven build and tests, an 80% coverage floor     |
| `pulumi`             | Azure OIDC login, then a Pulumi preview or up                                                      |
| `python-audit`       | Runs pip-audit and writes a findings file                                                          |
| `python-deps`        | Installs a Python package manager, the project's dependencies and pip-audit                        |
| `python-quality`     | Runs ruff, black, mypy and pytest and captures their output                                        |
| `quality-gate`       | Evaluates the results of earlier jobs, fails if a required one failed, and posts the PR comment    |
| `release-matrix`     | Turns release-please outputs into a matrix of released packages                                    |
| `review-skip`        | Decides whether a pull request needs a full code review                                            |
| `security`           | Runs Semgrep and Gitleaks, installing either when the runner lacks it                              |
| `setup-runtime`      | Installs the toolchain the repository pins (mise, `.tool-versions`, `.node-version`), with cache   |
| `trunk`              | Runs Trunk-managed linters                                                                         |
| `turbo`              | Installs dependencies, restores caches and runs Turbo tasks                                        |

When a gate check fails, the comment links to the matching page in
[docs/kb](docs/kb/).

## Development

The TypeScript in [packages/devops-actions](packages/devops-actions/) builds
into each action's `dist/` folder. The built files are committed, because an
action runs them with plain `node` and no install step.

```sh
mise install
bun install
bun run lint && bun run typecheck && bun run test
bun run build   # then commit the changed dist/ files
```

CI fails when `dist/` differs from a fresh build.

CI also runs `detect-language`, the JVM and .NET quality and audit actions
and the security action from the checkout against small projects in
[test-fixtures](test-fixtures/). Each passing project must pass, and each
deliberately broken one (`*-bad`) must fail in exactly the phases it
breaks, so a change to an action is exercised before anyone pins it.
