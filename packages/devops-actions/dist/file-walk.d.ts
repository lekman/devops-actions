/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * A bounded walk of a repository tree, for questions such as "does this
 * repository hold any Kotlin sources" or "where are its .csproj files".
 *
 * JVM and .NET projects keep their sources and project files below the
 * root, often several levels down (`src/main/kotlin/com/acme/...`), so a
 * root-only check misses them. A full walk of a large monorepo is slow,
 * so the walk skips build output and dependency folders and stops at a
 * depth and a file count. Stopping early can only make a check report
 * "not found", which turns a phase off rather than producing a wrong
 * result.
 */
/** Folders that hold build output, dependencies or tool state. */
export declare const SKIPPED_DIRS: ReadonlySet<string>;
export interface WalkOptions {
    /** Folder levels below the root to enter. The root itself is level 0. */
    maxDepth?: number;
    /** Stop after this many files have been listed. */
    maxFiles?: number;
}
/**
 * List files below `root` as paths relative to it, using `/` as the
 * separator. Folders in {@link SKIPPED_DIRS} and folders whose name
 * starts with a dot are not entered. Unreadable folders are skipped.
 *
 * @param root Absolute path to start from.
 * @param options Depth and file-count limits.
 */
export declare function listFiles(root: string, options?: WalkOptions): string[];
/**
 * True when any listed file ends with one of the extensions.
 *
 * @param files Paths from {@link listFiles}.
 * @param extensions Extensions with their leading dot, e.g. `.kt`.
 */
export declare function hasExtension(files: readonly string[], ...extensions: string[]): boolean;
