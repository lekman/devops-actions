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
/** Where the pinned toolchain was read from. Empty when none was found. */
export type RustToolchainSource = "mise" | "rust-toolchain.toml" | "rust-toolchain" | "";
export interface RustInfo {
    /** True when Cargo.toml declares a `[workspace]` table. */
    workspace: boolean;
    /** True when Cargo.lock sits beside Cargo.toml. */
    hasLockfile: boolean;
    /** Pinned toolchain, such as "1.100.0" or "stable". Empty when none. */
    toolchain: string;
    toolchainSource: RustToolchainSource;
    /**
     * The file the toolchain came from, relative to `stopAt`, such as
     * "rust-toolchain.toml". Empty when none was found.
     */
    toolchainFile: string;
}
/**
 * Probe a folder for a Rust project.
 *
 * @param root Absolute path to the folder that holds Cargo.toml.
 * @param stopAt Highest folder to look in for a toolchain file, usually
 *   the repository root. Defaults to `root`.
 * @returns The Rust details, or null when `root` has no Cargo.toml.
 */
export declare function detectRust(root: string, stopAt?: string): RustInfo | null;
interface ToolchainPin {
    toolchain: string;
    source: Exclude<RustToolchainSource, "">;
    file: string;
}
/**
 * Read `rust` from a mise config or .tool-versions in one folder. A config
 * that names no rust does not count, so the search goes on to the rustup
 * files.
 *
 * @param dir Absolute folder path.
 */
export declare function readMisePin(dir: string): ToolchainPin | null;
/**
 * Read the channel from rust-toolchain.toml, or from the legacy
 * rust-toolchain file, which holds either the same TOML or a bare channel
 * on its first line.
 *
 * @param dir Absolute folder path.
 */
export declare function readRustupPin(dir: string): ToolchainPin | null;
export {};
