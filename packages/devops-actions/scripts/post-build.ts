/**
 * Copies compiled JS from dist/ into the corresponding .github/actions/ folders.
 * Run automatically after tsc via the build script.
 *
 * Each action gets every module it imports, because it runs as bare
 * `node <action>/dist/<entry>.js` with no node_modules beside it. A module
 * shared by two actions is listed once per action.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..", "..");
const dist = resolve(import.meta.dirname, "..", "dist");
const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "..", "package.json"), "utf8"),
) as { version: string };

// Action folder to the compiled modules it runs, entry point first, then
// every module that entry imports, directly or through another.
const actions: Record<string, string[]> = {
  "quality-gate": ["quality-gate.js"],
  "branch-maintenance": ["branch-maintenance.js"],
  "findings-tests": ["findings-tests.js", "coverage.js"],
  "findings-security": ["findings-security.js"],
  "release-matrix": ["release-matrix.js"],
  "python-audit": ["findings-audit.js"],
  "jvm-audit": ["findings-audit.js"],
  "rust-audit": ["findings-audit.js"],
  "dotnet-audit": [
    "findings-audit.js",
    "project-inspect.js",
    "file-walk.js",
    "dotnet-detect.js",
  ],
  "detect-language": [
    "language-detect.js",
    "toml-lite.js",
    "file-walk.js",
    "jvm-detect.js",
    "dotnet-detect.js",
    "rust-detect.js",
  ],
  "jvm-quality": [
    "project-inspect.js",
    "coverage-check.js",
    "coverage.js",
    "file-walk.js",
    "dotnet-detect.js",
  ],
  "dotnet-quality": [
    "project-inspect.js",
    "coverage-check.js",
    "trx-junit.js",
    "coverage.js",
    "file-walk.js",
    "dotnet-detect.js",
  ],
};

const targets: Array<[src: string, dest: string]> = Object.entries(
  actions,
).flatMap(([action, modules]) =>
  modules.map((module): [string, string] => [
    module,
    resolve(root, ".github/actions", action, "dist", module),
  ]),
);

for (const [src, dest] of targets) {
  const srcPath = resolve(dist, src);
  const contents = readFileSync(srcPath, "utf8").replaceAll(
    "__PKG_VERSION__",
    pkg.version,
  );
  writeFileSync(srcPath, contents);
  mkdirSync(resolve(dest, ".."), { recursive: true });
  cpSync(srcPath, dest);
  console.log(`Copied ${src} (v${pkg.version}) → ${dest.replace(root, "")}`);
}
