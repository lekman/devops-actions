# @lekman/devops-actions

Six CI/CD tools that turn raw job output into things a human can act on:
quality and security gate summaries, a release matrix, branch maintenance, and
structured failure issues.

Each is an independent module. There is **no root import** — you import the one
you need, so nothing else is pulled in.

The modules are built into `.github/actions/*/dist/` and run there. The
package is not published.

## Modules

| Import                                      | What it does                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@lekman/devops-actions/quality-gate`       | Evaluates a Quality Gate from per-dimension results and renders the sticky PR comment                     |
| `@lekman/devops-actions/findings-tests`     | Parses JUnit XML, LCOV, lint logs and `tsc` output into a test/coverage summary with failure tables       |
| `@lekman/devops-actions/findings-security`  | Parses Semgrep JSON into a severity-sorted findings table (ERROR > WARNING > INFO), capped at 20 rows     |
| `@lekman/devops-actions/release-matrix`     | Builds a matrix of released packages from `release-please-action` outputs, for downstream publish jobs    |
| `@lekman/devops-actions/branch-maintenance` | Scans open PRs across an org or repo, auto-updates stale branches and comments on conflicted ones         |

## Usage

### Parse test results into a summary

```ts
import { parseJunit } from "@lekman/devops-actions/findings-tests";

const summary = parseJunit(await readFile("junit.xml", "utf8"));
// parseJunit returns null when the XML has no <testsuites> element
if (summary) {
  console.log(
    `${summary.tests} tests, ${summary.failures} failed, ${summary.skipped} skipped`,
  );
}
```

`findings-tests` also parses LCOV for line coverage, and lint or `tsc` logs
into error tables — useful when you want one comment covering every dimension
rather than four.

### Evaluate a quality gate

`evaluate` takes the job names you require and the results GitHub Actions
produced for them, and tells you whether the gate passes and what failed.

```ts
import { evaluate } from "@lekman/devops-actions/quality-gate";

const { pass, failures } = evaluate({
  required: ["quality"],
  conditional: ["trunk-check", "deliver"], // must pass when they run, OK when skipped
  results: { quality: "failure", "trunk-check": "skipped", deliver: "success" },
});

console.log(pass, failures); // false, ["quality"]
```

`requiredWhenInfraChanged` adds jobs that only count when infrastructure
changed, so a docs-only PR is not held to them.

### Build a release matrix

```ts
import { buildReleaseMatrix } from "@lekman/devops-actions/release-matrix";

const matrix = buildReleaseMatrix({
  releaseOutputs: outputs, // the full steps.<release>.outputs object
  configContents: await readFile("release-please-config.json", "utf8"),
  repoRoot: process.cwd(),
});
```

Feed the result straight into a job's `strategy.matrix` so only the packages
that actually released get published.

## Running the modules directly

Each module is also an executable entry point, which is how the composite
actions in this repository consume them:

```bash
node node_modules/@lekman/devops-actions/dist/quality-gate.js
```

The `./dist/*` subpath is exported for exactly this, so the file path stays
resolvable through the package rather than by reaching into `node_modules`.

## Types

Every module ships its own `.d.ts`. Importing a subpath gives you its types
with no extra install.

## Requirements

Node 20 or later. No runtime dependencies.

## Licence

MIT © Tobias Lekman
