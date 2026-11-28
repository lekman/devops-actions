/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * Reads the Rust side of a repository: whether a Cargo.toml sits at the
 * root, whether it is a workspace, whether Cargo.lock is committed beside
 * it, and which toolchain the repository pins.
 *
 * The toolchain comes from the repository, never from this action, the
 * same as setup-runtime does for Node and Python. Two declarations count:
 *
 *   mise              `rust` under `[tools]` in mise.toml, .mise.toml or
 *                     mise/config.toml, or a `rust` line in .tool-versions
 *   rust-toolchain    `[toolchain] channel` in rust-toolchain.toml, or the
 *                     legacy rust-toolchain file
 *
 * mise wins when both exist, because an explicit mise config overrides an
 * idiomatic version file when mise resolves the version (checked with
 * mise 2026.7.6). Each file is looked for in the project folder first and
 * then in each folder above it up to `stopAt`, which is how both mise and
 * rustup find them.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
// Explicit .js specifiers: the compiled action runs under node's ESM
// resolver, which does not add extensions the way a bundler does.
import { getString, hasTable, parseToml } from "./toml-lite.js";
/** mise config files, in the order setup-runtime reads them. */
const MISE_FILES = ["mise.toml", ".mise.toml", "mise/config.toml"];
/**
 * Probe a folder for a Rust project.
 *
 * @param root Absolute path to the folder that holds Cargo.toml.
 * @param stopAt Highest folder to look in for a toolchain file, usually
 *   the repository root. Defaults to `root`.
 * @returns The Rust details, or null when `root` has no Cargo.toml.
 */
export function detectRust(root, stopAt = root) {
    const manifest = resolve(root, "Cargo.toml");
    if (!existsSync(manifest))
        return null;
    let workspace = false;
    try {
        workspace = hasTable(parseToml(readFileSync(manifest, "utf8")), "workspace");
    }
    catch {
        // An unreadable manifest still marks the folder as Rust.
    }
    const pin = findToolchain(root, stopAt);
    return {
        workspace,
        hasLockfile: existsSync(resolve(root, "Cargo.lock")),
        toolchain: pin?.toolchain ?? "",
        toolchainSource: pin?.source ?? "",
        toolchainFile: pin ? relative(resolve(stopAt), pin.file) || pin.file : "",
    };
}
/**
 * Walk from `root` up to `stopAt` and return the first pin found. In each
 * folder mise is checked before the rustup files.
 */
function findToolchain(root, stopAt) {
    const top = resolve(stopAt);
    let dir = resolve(root);
    for (;;) {
        const pin = readMisePin(dir) ?? readRustupPin(dir);
        if (pin)
            return pin;
        if (dir === top || !isInside(dir, top))
            return null;
        const parent = dirname(dir);
        if (parent === dir)
            return null;
        dir = parent;
    }
}
function isInside(dir, top) {
    const rel = relative(top, dir);
    return rel !== "" && !rel.startsWith("..") && !rel.startsWith("/");
}
/**
 * Read `rust` from a mise config or .tool-versions in one folder. A config
 * that names no rust does not count, so the search goes on to the rustup
 * files.
 *
 * @param dir Absolute folder path.
 */
export function readMisePin(dir) {
    for (const name of MISE_FILES) {
        const file = resolve(dir, name);
        const text = readText(file);
        if (text === null)
            continue;
        const doc = parseToml(text);
        const version = getString(doc, "tools.rust") ?? getString(doc, "tools.core:rust");
        if (version)
            return { toolchain: version, source: "mise", file };
    }
    const file = resolve(dir, ".tool-versions");
    const text = readText(file);
    if (text !== null) {
        for (const line of text.split("\n")) {
            const [tool, version] = line.trim().split(/\s+/);
            if (tool === "rust" && version) {
                return { toolchain: version, source: "mise", file };
            }
        }
    }
    return null;
}
/**
 * Read the channel from rust-toolchain.toml, or from the legacy
 * rust-toolchain file, which holds either the same TOML or a bare channel
 * on its first line.
 *
 * @param dir Absolute folder path.
 */
export function readRustupPin(dir) {
    const tomlFile = resolve(dir, "rust-toolchain.toml");
    const toml = readText(tomlFile);
    if (toml !== null) {
        const channel = getString(parseToml(toml), "toolchain.channel");
        if (channel) {
            return {
                toolchain: channel,
                source: "rust-toolchain.toml",
                file: tomlFile,
            };
        }
    }
    const legacyFile = resolve(dir, "rust-toolchain");
    const legacy = readText(legacyFile);
    if (legacy !== null) {
        const channel = legacy.includes("[toolchain]")
            ? getString(parseToml(legacy), "toolchain.channel")
            : legacy.split("\n")[0]?.trim();
        if (channel) {
            return { toolchain: channel, source: "rust-toolchain", file: legacyFile };
        }
    }
    return null;
}
function readText(path) {
    if (!existsSync(path))
        return null;
    try {
        return readFileSync(path, "utf8");
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=rust-detect.js.map