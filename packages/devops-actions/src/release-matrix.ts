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

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  appendFileSync,
} from "node:fs";
import { resolve } from "node:path";

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

export type Language =
  | "node"
  | "python"
  | "docker"
  | "helm"
  | "kotlin"
  | "powershell"
  | "unknown";

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
export function buildReleaseMatrix(opts: {
  releaseOutputs: Record<string, string>;
  configContents: string;
  repoRoot: string;
}): ReleaseMatrix {
  const { releaseOutputs, configContents, repoRoot } = opts;

  const releasesCreated = releaseOutputs.releases_created === "true";
  if (!releasesCreated) {
    return { entries: [], drift: [], releasesCreated: false };
  }

  const config = parseConfig(configContents);
  const configuredPaths = new Set(Object.keys(config.packages));

  const entries: ReleaseMatrixEntry[] = [];
  const drift: string[] = [];

  // Walk every key shaped `<path>--release_created`; the path segment tells us
  // which packages are in this run, and the sibling `<path>--tag_name` and
  // `<path>--version` keys give us the metadata.
  for (const [key, value] of Object.entries(releaseOutputs)) {
    if (!key.endsWith("--release_created")) continue;
    if (value !== "true") continue;

    const path = key.slice(0, -"--release_created".length);
    const tag = releaseOutputs[`${path}--tag_name`] ?? "";
    const version = releaseOutputs[`${path}--version`] ?? "";
    const name = parseNameFromTag(tag, path);

    if (!configuredPaths.has(path)) {
      drift.push(path);
    }

    const releaseType =
      config.packages[path]?.["release-type"] ?? config["release-type"] ?? "";

    const pkgDir = resolve(repoRoot, path);
    const language = detectLanguage(pkgDir);
    const pkgJson = readPackageJson(pkgDir);

    const publishable =
      language === "node" && pkgJson !== null && pkgJson.private !== true;
    const hasBuild =
      pkgJson !== null && typeof pkgJson.scripts?.build === "string";
    const registry = pkgJson?.publishConfig?.registry;

    entries.push({
      name,
      path,
      tag,
      version,
      releaseType,
      language,
      publishable,
      hasBuild,
      registry,
    });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  drift.sort();

  return { entries, drift, releasesCreated: true };
}

// ---- Helpers ----

interface ReleasePleaseConfig {
  "release-type"?: string;
  packages: Record<
    string,
    { "release-type"?: string; "package-name"?: string }
  >;
}

function parseConfig(contents: string): ReleasePleaseConfig {
  try {
    const raw = JSON.parse(contents) as Partial<ReleasePleaseConfig>;
    return {
      "release-type": raw["release-type"],
      packages: raw.packages ?? {},
    };
  } catch {
    return { packages: {} };
  }
}

interface PackageJson {
  name?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  publishConfig?: { registry?: string };
}

function readPackageJson(dir: string): PackageJson | null {
  const path = resolve(dir, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

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
export function parseNameFromTag(tag: string, path: string): string {
  const match = tag.match(/^(.*?)[-@]v\d+\.\d+\.\d+/);
  if (match && match[1]) return match[1];

  const pkg = readPackageJson(resolve(process.cwd(), path));
  if (pkg?.name) return pkg.name;

  return path.split("/").pop() ?? path;
}

function detectLanguage(dir: string): Language {
  if (!existsSync(dir)) return "unknown";

  // Order matters: package.json wins over transient Dockerfiles that are
  // just for local dev. Kotlin/PowerShell checks stay last — they walk the
  // tree, which is slower.
  if (existsSync(resolve(dir, "package.json"))) return "node";
  if (
    existsSync(resolve(dir, "pyproject.toml")) ||
    existsSync(resolve(dir, "setup.py"))
  ) {
    return "python";
  }
  if (
    existsSync(resolve(dir, "Chart.yaml")) ||
    existsSync(resolve(dir, "Chart.yml")) ||
    existsSync(resolve(dir, "chart.yaml")) ||
    existsSync(resolve(dir, "chart.yml"))
  ) {
    return "helm";
  }
  if (existsSync(resolve(dir, "Dockerfile"))) return "docker";
  if (findFileByExt(dir, [".kt", ".kts"])) return "kotlin";
  if (findFileByExt(dir, [".psd1"])) return "powershell";

  return "unknown";
}

function findFileByExt(dir: string, exts: string[]): boolean {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isFile() && exts.some((e) => entry.endsWith(e))) return true;
  }
  return false;
}

// ---- CLI ----

/* eslint-disable no-console -- CLI entrypoint, console output is intentional */
function main(): void {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--/, "");
    const value = process.argv[i + 1];
    if (key && value !== undefined) args.set(key, value);
  }

  const releaseOutputsRaw = args.get("release-outputs");
  const configFile = args.get("config-file");
  const repoRoot = args.get("repo-root") ?? process.cwd();

  if (!releaseOutputsRaw) {
    console.error("release-matrix: --release-outputs is required");
    process.exit(1);
  }
  if (!configFile) {
    console.error("release-matrix: --config-file is required");
    process.exit(1);
  }

  let releaseOutputs: Record<string, string>;
  try {
    const parsed: unknown = JSON.parse(releaseOutputsRaw);
    if (typeof parsed !== "object" || parsed === null)
      throw new Error("not an object");
    releaseOutputs = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      releaseOutputs[k] = v === null || v === undefined ? "" : String(v);
    }
  } catch (err) {
    console.error(
      `release-matrix: failed to parse --release-outputs JSON: ${(err as Error).message}`,
    );
    process.exit(1);
  }

  const configContents = existsSync(configFile)
    ? readFileSync(configFile, "utf8")
    : "{}";

  const matrix = buildReleaseMatrix({
    releaseOutputs,
    configContents,
    repoRoot,
  });

  for (const path of matrix.drift) {
    console.log(
      `::warning::Released path "${path}" is not listed in ${configFile} (drift)`,
    );
  }

  const githubOutput = process.env.GITHUB_OUTPUT;
  const matrixJson = JSON.stringify(matrix.entries);
  const releasesCreated = matrix.releasesCreated ? "true" : "false";

  if (githubOutput) {
    appendFileSync(
      githubOutput,
      `matrix=${matrixJson}\nreleases_created=${releasesCreated}\n`,
    );
  }

  console.log(
    `release-matrix: ${matrix.entries.length} entrie(s), releases_created=${releasesCreated}`,
  );
  console.log(matrixJson);
}

if (import.meta.main) {
  main();
}
/* eslint-enable no-console */
