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

import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Dirent } from "node:fs";

/** Folders that hold build output, dependencies or tool state. */
export const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  ".git",
  ".gradle",
  ".idea",
  ".kotlin",
  ".mvn",
  ".venv",
  ".vs",
  "__pycache__",
  "bin",
  "build",
  "dist",
  "node_modules",
  "obj",
  "out",
  "target",
  "TestResults",
  "venv",
]);

export interface WalkOptions {
  /** Folder levels below the root to enter. The root itself is level 0. */
  maxDepth?: number;
  /** Stop after this many files have been listed. */
  maxFiles?: number;
}

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_FILES = 50_000;

/**
 * List files below `root` as paths relative to it, using `/` as the
 * separator. Folders in {@link SKIPPED_DIRS} and folders whose name
 * starts with a dot are not entered. Unreadable folders are skipped.
 *
 * @param root Absolute path to start from.
 * @param options Depth and file-count limits.
 */
export function listFiles(root: string, options: WalkOptions = {}): string[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const files: string[] = [];
  const queue: Array<{ rel: string; depth: number }> = [{ rel: "", depth: 0 }];

  // Breadth first, so a file-count stop keeps the shallow files, which
  // are the ones that describe the project.
  while (queue.length > 0 && files.length < maxFiles) {
    const { rel, depth } = queue.shift() as { rel: string; depth: number };
    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (depth >= maxDepth) continue;
        if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith(".")) {
          continue;
        }
        queue.push({ rel: path, depth: depth + 1 });
      } else if (entry.isFile()) {
        files.push(path);
        if (files.length >= maxFiles) break;
      }
    }
  }

  return files;
}

/**
 * True when any listed file ends with one of the extensions.
 *
 * @param files Paths from {@link listFiles}.
 * @param extensions Extensions with their leading dot, e.g. `.kt`.
 */
export function hasExtension(
  files: readonly string[],
  ...extensions: string[]
): boolean {
  return files.some((f) => extensions.some((ext) => f.endsWith(ext)));
}
