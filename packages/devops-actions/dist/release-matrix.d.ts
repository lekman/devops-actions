/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Builds a matrix of released packages from release-please-action outputs.
 *
 * Consumed by the `release-matrix` composite action and downstream
 * `publish` / `attach-test-evidence` jobs in the reusable release.yml.
 *
 * Inputs (all strings, as produced by GitHub Actions):
 *   - release-outputs JSON (the full `steps.<release>.outputs` object)
 *   - release-please config file contents
 *   - repo root (for file-system probes: package.json, Dockerfile, ...)
 *
 * Output: an array of entries — one per path with `--release_created = true`
 * — plus a drift list (released paths absent from config) and a boolean
 * releasesCreated flag.
 *
 * No hard-coded package names. Fields each downstream job needs are
 * precomputed here, so workflow YAML stays thin.
 */
export interface ReleaseMatrixEntry {
    /** Package name parsed from tag prefix (everything before the last '@' or '-v'). */
    name: string;
    /** Path within the repo, e.g. "packages/test-automation". */
    path: string;
    /** Full tag name from release-please, e.g. "packages/test-automation-v0.1.0". */
    tag: string;
    /** Semver version from release-please. */
    version: string;
    /** release-please config's release-type for this path (node, python, ...). */
    releaseType: string;
    /** Detected language/runtime by probing files in the package directory. */
    language: Language;
    /** Whether the package is eligible for npm publish (node + not private). */
    publishable: boolean;
    /** True if the package.json declares a `scripts.build`. */
    hasBuild: boolean;
    /** Target registry from package.json `publishConfig.registry`, if set. */
    registry?: string;
}
export type Language = "node" | "python" | "docker" | "helm" | "kotlin" | "powershell" | "unknown";
export interface ReleaseMatrix {
    entries: ReleaseMatrixEntry[];
    /** Paths that were released but are not listed in the config. */
    drift: string[];
    releasesCreated: boolean;
}
/**
 * Parse the raw release-please outputs object and emit a structured matrix.
 *
 * `releaseOutputs` is the full `steps.<release>.outputs` record — every key
 * is a string because that's what GitHub Actions hands us (booleans are
 * `"true"`/`"false"`, arrays are JSON-encoded strings).
 */
export declare function buildReleaseMatrix(opts: {
    releaseOutputs: Record<string, string>;
    configContents: string;
    repoRoot: string;
}): ReleaseMatrix;
/**
 * Tag format from release-please is one of:
 *   - "<pkg>@v1.2.3"   (include-v-in-tag + scoped-style separator)
 *   - "<pkg>-v1.2.3"   (default separator with include-v-in-tag)
 *   - "v1.2.3"         (single-package repo)
 *
 * We strip the trailing `[@-]v<semver>` to recover the name. If we can't
 * match it cleanly, fall back to deriving a name from the package.json or
 * the path's last segment.
 */
export declare function parseNameFromTag(tag: string, path: string): string;
