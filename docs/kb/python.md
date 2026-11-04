# Python Projects

Covers how CI recognises a Python project, which checks it runs, and what to
change when a check does not behave the way you expect.

Read this if your repository contains a `pyproject.toml` or a `setup.py` and
you are wiring it into the shared CI workflow, or if a Python check reported
something surprising.

## What CI Detects

The `detect` job runs the `detect-language` action, which reads the
repository root and reports what it finds. Every Python step later in the
run is gated on those outputs, so a repository with no Python runs no Python
steps.

| Signal                         | What It Sets                                   |
| ------------------------------ | ---------------------------------------------- |
| `pyproject.toml` or `setup.py` | Python is present                              |
| `poetry.lock`                  | Package manager is Poetry                      |
| `uv.lock`                      | Package manager is uv                          |
| `Pipfile.lock` or `Pipfile`    | Package manager is pipenv                      |
| `[tool.poetry]` or `[tool.uv]` | Package manager, when no lockfile is committed |
| none of the above              | Package manager is pip                         |
| `.python-version`              | Interpreter version                            |
| `project.requires-python`      | Interpreter version, when there is no file     |
| `[tool.ruff]`, `[tool.black]`  | Lint runs, using those tools                   |
| `[tool.mypy]`                  | Typecheck runs                                 |
| `[tool.pytest.*]` or `tests/`  | Tests run                                      |

The tool tables are read in that order, so a project that commits no
lockfile is still recognised as a Poetry or uv project. Without that
fallback, CI would run `pip install -e ".[dev]"` against a Poetry project,
which fails on any layout pip cannot build.

The action also reports whether the project is buildable, meaning it
declares a PEP 517 `[build-system]` and is not a Poetry workspace with
`package-mode = false`. No build step consumes that yet. It is reported so
a build phase can be added without changing detection.

## Pinning the Interpreter

CI installs the interpreter through mise, and the version comes from the
repository. Nothing is defaulted, because a toolkit that picks the version
hands every consumer the toolkit's Python instead of their own, and the
drift stays invisible until something breaks in CI that worked locally.

Either file works as the pin.

```
# .python-version
3.12.7
```

```toml
# pyproject.toml
[project]
requires-python = ">=3.12"
```

A `.python-version` file wins when both are present. From
`requires-python`, CI reads the first version in the specifier, so `>=3.12`
installs 3.12. A repository that pins neither fails the toolchain step with
a message naming the fix. That is the same treatment a repository declaring
no toolchain at all receives.

## Which Checks Run

The `quality` job runs lint, typecheck and tests. Each phase runs even when
an earlier one fails, so one push surfaces every problem rather than the
first.

| Phase     | Command                                | Enabled By                    |
| --------- | -------------------------------------- | ----------------------------- |
| Lint      | `ruff check --output-format=concise .` | `[tool.ruff]`                 |
| Lint      | `black --check .`                      | `[tool.black]`                |
| Typecheck | `mypy .`                               | `[tool.mypy]`                 |
| Test      | `pytest --junitxml=junit.xml -v`       | `[tool.pytest.*]` or `tests/` |
| Audit     | `pip-audit -r <exported requirements>` | Any Python project            |

Poetry, pipenv and uv create a virtual environment that CI never activates,
so every command above is invoked through that package manager's runner, for
example `poetry run pytest`. Projects using pip call the tools directly.

`flake8` and `pylint` are detected but not run. Neither has a stable default
output format that the findings parser reads, so running them would produce
a failing phase with an empty findings table.

## Coverage

Coverage runs only when `pytest-cov` is importable in the project's
environment. CI probes for it first, because passing `--cov` without the
plugin fails the whole test run on an unrecognised argument.

What coverage measures follows from your configuration.

```toml
# pyproject.toml
[tool.coverage.run]
source = ["src"]
```

With that table present, CI passes a bare `--cov` and lets coverage.py use
your setting. Without it, CI falls back to `--cov=.`, which also measures
the test files and reports a higher number than the source alone earns. On
a sample project the difference was 92% against 80%. Set the table if the
number matters to you.

## Common Failures

| Symptom                                                     | Cause                                                                     | Fix                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Toolchain step fails with "no toolchain declared"           | The repository pins no interpreter version                                | Add a `.python-version` file, or set `requires-python` in `pyproject.toml`                     |
| A lint tool reports "configured but not installed"          | `pyproject.toml` configures the tool, the environment does not contain it | Add the tool to your dev dependencies. CI reports this as skipped rather than as lint findings |
| Tests run but report no coverage                            | `pytest-cov` is not in the project's dev dependencies                     | Add `pytest-cov`. CI skips coverage silently rather than failing the run                       |
| Coverage looks higher than expected                         | `--cov=.` is measuring the test files                                     | Add `[tool.coverage.run]` with a `source` list                                                 |
| Dependencies install with pip on a Poetry project           | Neither a lockfile nor a `[tool.poetry]` table is present                 | Commit `poetry.lock`, or keep the `[tool.poetry]` table in `pyproject.toml`                    |
| Audit reports "did not complete"                            | pip-audit was missing, or the dependency export failed                    | See [Dependency Audit](#dependency-audit) below                                                |
| Ruff findings appear in the log but not in the gate comment | The lint step is not using the concise output format                      | CI pins `--output-format=concise`. If you run ruff yourself, the default format is not parsed  |

## Dependency Audit

The `audit` job runs pip-audit against the project's resolved dependencies
and reports advisories in the Security Gate.

pip-audit is installed in its own isolated environment. Running it without
naming a requirements file scans that environment rather than your project,
so CI exports your dependencies first:

| Package Manager | Export                                                 |
| --------------- | ------------------------------------------------------ |
| Poetry          | `poetry export`, falling back to reading `poetry.lock` |
| uv              | `uv export --no-hashes`                                |
| pipenv          | `pipenv requirements`                                  |
| pip             | the committed `requirements.txt`, else `pip freeze`    |

The Poetry fallback exists because Poetry 2.x moved `export` into an
optional plugin that the runner does not install. Reading the lock directly
gives the same pinned versions.

Two kinds of line are removed before the audit runs. Editable installs
(`-e <path>`) would make pip-audit try to build the target. Git dependencies
(`git+<url>`) resolve inside pip-audit's own environment, where the Git
credentials from the install step are absent, so one private dependency
would otherwise take the whole audit down. A Git dependency pinned to a
commit has no advisory to match in any case, and its third-party
dependencies are exported as separate pinned entries that are still audited.

### Why an Incomplete Audit Fails the Job

Advisories do not fail the job. The gate reports them and you decide.

An audit that could not run does fail the job, by default. The gate row
carries only success, failure or skipped, so an audit that ran and found
nothing looks identical to an audit that never ran at all. Failing is the
only way the second one is visible without expanding the block.

Set `fail-on-indeterminate: false` on the action to accept a green row for
an audit that checked nothing.

## Preinstalled Interpreters

`setup-runtime` installs the pinned interpreter through mise and restores
mise's data directory from the Actions cache. A self-hosted runner image can
carry mise and the interpreter in that same directory, in which case the
cache restore only costs time. The step checks for that first: when
`mise where python@<pinned>` succeeds on the runner, the cache is skipped
and mise reports the interpreter as already installed. Nothing changes for
GitHub-hosted runners, which start empty and keep the cache.

The image's Python must match what the pin resolves to. A pin of `3.12`
resolves to the newest 3.12.x mise knows, so an image built with an older
patch stops matching when a new one is published, and the step falls back
to the download until the image is rebuilt.

## Python in a Subdirectory

Detection reads one directory, the repository root by default. A monorepo
that keeps its Python project under a path such as `services/collector`
passes that path as `python-dir`, and detection, dependency install,
quality and audit all run there.

```yaml
jobs:
  ci:
    uses: lekman/devops-toolkit/.github/workflows/ci.yml@main
    secrets: inherit
    with:
      python-dir: services/collector
```

The interpreter pin is read from that directory too, so `.python-version`
or `requires-python` belongs next to the `pyproject.toml`, not at the root.
One directory per call: a repository with several Python projects needs a
call per project, since the outputs describe a single manifest.

## Local Reproduction

Run the same commands CI runs. Replace the `poetry run` prefix with
`uv run`, `pipenv run`, or nothing, to match your package manager.

```bash
# Lint
poetry run ruff check --output-format=concise .
poetry run black --check .

# Typecheck
poetry run mypy .

# Test, with the same reporters CI reads
poetry run pytest --junitxml=junit.xml -v \
  --cov --cov-report=xml:coverage.xml --cov-report=term-missing

# Audit
poetry export --without-hashes --format requirements.txt -o /tmp/reqs.txt
pip-audit -r /tmp/reqs.txt
```

## Related Pages

- [Test Failures](tests.md) for how the gate reads `junit.xml`
- [Lint Failures](lint.md) for the shared lint reporting
- [Security Scan Failures](security.md) for Semgrep and secret detection
- [Quality Gate](quality-gate.md) for how the pass and fail decision is made
