# Build Failures

Covers `turbo build` and `tsc` compilation failures in the **quality** CI job.

The quality job runs `turbo run build lint typecheck test:coverage` (or `bun run build` as fallback). Build failures prevent downstream tasks from running.

## Common Failures

| Symptom                               | Cause                                                                 | Fix                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `tsc` exits with type errors          | Strict mode catches nullable, implicit-any, or unchecked index access | Fix the type errors. Run `bun run build` locally to reproduce                                                                              |
| `Cannot find module` in build output  | Missing dependency or wrong import path                               | Check `package.json` dependencies. Use `bun install` to sync lockfile                                                                      |
| `bun install --frozen-lockfile` fails | `bun.lock` is out of sync with `package.json`                         | Run `bun install` locally, commit the updated `bun.lock`                                                                                   |
| Build passes locally but fails in CI  | Different Bun or TypeScript version on runner                         | Check the runner has the expected versions. The CI uses `nb-runner-arm64` with pre-installed Bun                                           |
| `ERR_MODULE_NOT_FOUND` at runtime     | ES module import missing `.js` extension in compiled output           | TypeScript with `bundler` moduleResolution does not enforce extensions. Ensure import paths resolve correctly under `ES2022` module output |
| Native dependency compilation fails   | `node-gyp` or native addon not compatible with ARM64                  | Check if the dependency publishes ARM64 prebuilds. Use `bun install --force` to retry. Consider replacing with a pure-JS alternative       |

## Turbo Cache Issues

| Symptom                       | Cause                                                                  | Fix                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Build fails with stale output | Turbo restored a cached build that is incompatible with current source | Delete `.turbo` locally and push. The CI cache is keyed on `bun.lock` hash — updating dependencies invalidates it |
| Build skipped unexpectedly    | Turbo hash matched a previous run                                      | Change a source file or run with `--force` to bypass cache                                                        |
| Cache miss on every run       | `turbo.json` inputs/outputs not configured                             | Verify `turbo.json` has correct `inputs` and `outputs` for the build task                                         |

## TypeScript Configuration

The toolkit uses strict TypeScript with these settings:

- **Target**: ES2022
- **Module**: ES2022
- **Module resolution**: bundler
- **Strict**: true (all strict checks enabled)
- **Declaration**: true (generates `.d.ts` files)

<details>
<summary>Common strict mode violations</summary>

| Error                                                         | Cause                                                     | Fix                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| `TS2322: Type 'X \| undefined' is not assignable to type 'X'` | Nullable value used where non-null expected               | Add a null check or use non-null assertion (`!`) if the value is guaranteed |
| `TS7006: Parameter 'x' implicitly has an 'any' type`          | Missing type annotation on function parameter             | Add explicit type annotations                                               |
| `TS2532: Object is possibly 'undefined'`                      | Optional chaining not used on possibly-undefined property | Use `?.` or check for `undefined` before accessing                          |
| `TS18046: 'x' is of type 'unknown'`                           | Caught error typed as `unknown` (strict mode default)     | Narrow with `instanceof Error` or type guard                                |

</details>

## Post-Build Distribution

After `tsc` compiles `src/*.ts` to `dist/*.js`, the `scripts/post-build.ts` script copies output into `.github/actions/{name}/dist/`. If you add a new module, you must add a copy target in `post-build.ts` or the action will reference a missing file.
