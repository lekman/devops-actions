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

const targets: Array<[src: string, dest: string]> = [
  [
    "quality-gate.js",
    resolve(root, ".github/actions/quality-gate/dist/quality-gate.js"),
  ],
  [
    "branch-maintenance.js",
    resolve(
      root,
      ".github/actions/branch-maintenance/dist/branch-maintenance.js",
    ),
  ],
  [
    "findings-tests.js",
    resolve(root, ".github/actions/findings-tests/dist/findings-tests.js"),
  ],
  [
    "findings-security.js",
    resolve(
      root,
      ".github/actions/findings-security/dist/findings-security.js",
    ),
  ],
  [
    "release-matrix.js",
    resolve(root, ".github/actions/release-matrix/dist/release-matrix.js"),
  ],
  [
    "findings-audit.js",
    resolve(root, ".github/actions/python-audit/dist/findings-audit.js"),
  ],
  [
    "language-detect.js",
    resolve(root, ".github/actions/detect-language/dist/language-detect.js"),
  ],
  // Imported by language-detect.js.
  [
    "toml-lite.js",
    resolve(root, ".github/actions/detect-language/dist/toml-lite.js"),
  ],
];

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
