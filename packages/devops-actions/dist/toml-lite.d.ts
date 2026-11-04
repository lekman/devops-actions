/**
 * Copyright (c) Tobias Lekman. All rights reserved.
 *
 * A line-based reader for the small part of TOML that Python project
 * detection needs. Two questions get answered:
 *
 *   - is a table present?          `[build-system]`, `[tool.ruff]`
 *   - what is this scalar key?     `project.name`, `project.requires-python`
 *
 * Compiled actions run as bare `node dist/*.js` with no `node_modules`
 * beside them, and this package declares no runtime dependencies. A real
 * TOML parser would have to be bundled first; nothing detection asks for
 * needs one.
 *
 * Known limits, all of which degrade to "key or table not found":
 *
 *   - Inline tables (`tool = { poetry = { name = "x" } }`) are not read.
 *     A pyproject written that way reports its tables as absent.
 *   - Arrays spanning several lines are skipped rather than parsed.
 *   - Array-of-tables headers (`[[tool.poetry.packages]]`) register as a
 *     table so presence checks work, and their keys are not collected.
 *   - Values are returned as written, minus surrounding quotes. No type
 *     coercion beyond the boolean literals `true` and `false`.
 *
 * Callers treat a miss as "phase not detected", so a pyproject this reader
 * cannot follow yields a skipped check rather than a wrong verdict.
 */
export interface TomlDocument {
    /**
     * Dotted table paths in the order they appear, without brackets.
     * A root-level key lives under the empty-string path.
     */
    tables: string[];
    /**
     * Dotted key path (`project.name`) to the scalar exactly as written,
     * quotes included. `getString` removes them; `getBoolean` relies on
     * them being there, so a quoted `"false"` reads as a string rather than
     * as the boolean.
     */
    values: Record<string, string>;
}
/**
 * Read a TOML document into flat table and key lists.
 *
 * @param content Raw file contents.
 */
export declare function parseToml(content: string): TomlDocument;
/**
 * True when `path` names a table in the document, or a table nested below
 * one. `hasTable(doc, "tool.pytest")` matches a
 * `[tool.pytest.ini_options]` header.
 *
 * @param doc Parsed document.
 * @param path Dotted table path without brackets.
 */
export declare function hasTable(doc: TomlDocument, path: string): boolean;
/**
 * Read a scalar by dotted key path. Returns undefined when the key is
 * absent or its value was not a scalar this reader follows.
 *
 * @param doc Parsed document.
 * @param path Dotted key path, e.g. `project.requires-python`.
 */
export declare function getString(doc: TomlDocument, path: string): string | undefined;
/**
 * Read a boolean by dotted key path. Anything that is not the literal
 * `true` or `false` returns undefined, so a caller can tell "absent" from
 * "explicitly false".
 *
 * @param doc Parsed document.
 * @param path Dotted key path, e.g. `tool.poetry.package-mode`.
 */
export declare function getBoolean(doc: TomlDocument, path: string): boolean | undefined;
