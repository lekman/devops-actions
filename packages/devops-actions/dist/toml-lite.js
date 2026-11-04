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
const TABLE_HEADER = /^\[{1,2}\s*([^\]]+?)\s*\]{1,2}\s*$/;
const KEY_VALUE = /^([A-Za-z0-9_.-]+|"[^"]*"|'[^']*')\s*=\s*(.*)$/;
/**
 * Read a TOML document into flat table and key lists.
 *
 * @param content Raw file contents.
 */
export function parseToml(content) {
    const tables = [];
    const values = {};
    let current = "";
    for (const raw of content.split("\n")) {
        const line = stripComment(raw).trim();
        if (line === "")
            continue;
        const header = line.match(TABLE_HEADER);
        if (header) {
            current = normaliseTablePath(header[1]);
            if (!tables.includes(current))
                tables.push(current);
            continue;
        }
        const pair = line.match(KEY_VALUE);
        if (!pair)
            continue;
        const value = readScalar(pair[2]);
        if (value === null)
            continue;
        const key = unquote(pair[1]);
        values[current ? `${current}.${key}` : key] = value;
    }
    return { tables, values };
}
/**
 * True when `path` names a table in the document, or a table nested below
 * one. `hasTable(doc, "tool.pytest")` matches a
 * `[tool.pytest.ini_options]` header.
 *
 * @param doc Parsed document.
 * @param path Dotted table path without brackets.
 */
export function hasTable(doc, path) {
    return doc.tables.some((t) => t === path || t.startsWith(`${path}.`));
}
/**
 * Read a scalar by dotted key path. Returns undefined when the key is
 * absent or its value was not a scalar this reader follows.
 *
 * @param doc Parsed document.
 * @param path Dotted key path, e.g. `project.requires-python`.
 */
export function getString(doc, path) {
    const raw = doc.values[path];
    return raw === undefined ? undefined : unquote(raw);
}
/**
 * Read a boolean by dotted key path. Anything that is not the literal
 * `true` or `false` returns undefined, so a caller can tell "absent" from
 * "explicitly false".
 *
 * @param doc Parsed document.
 * @param path Dotted key path, e.g. `tool.poetry.package-mode`.
 */
export function getBoolean(doc, path) {
    const raw = doc.values[path];
    if (raw === "true")
        return true;
    if (raw === "false")
        return false;
    return undefined;
}
// ---- Internals ----
/**
 * Drop a trailing `#` comment, leaving `#` inside quoted values alone.
 */
function stripComment(line) {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === quote)
                quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === "#")
            return line.slice(0, i);
    }
    return line;
}
/**
 * Normalise a table header's dotted path by unquoting each segment, so
 * `[tool."pytest.ini_options"]` and `[tool.pytest.ini_options]` agree.
 * The split is quote-aware because a quoted segment may itself contain
 * the separator.
 */
function normaliseTablePath(path) {
    return splitDotted(path)
        .map((segment) => unquote(segment.trim()))
        .join(".");
}
/**
 * Split a dotted path on the separators that sit outside quotes.
 */
function splitDotted(path) {
    const segments = [];
    let current = "";
    let quote = null;
    for (const ch of path) {
        if (quote) {
            current += ch;
            if (ch === quote)
                quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === ".") {
            segments.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    segments.push(current);
    return segments;
}
function unquote(token) {
    const first = token[0];
    if ((first === '"' || first === "'") && token.endsWith(first)) {
        return token.slice(1, -1);
    }
    return token;
}
/**
 * Interpret the right-hand side of a key/value line, returning the token
 * as written. Quotes are kept so callers can tell a quoted `"false"` from
 * the boolean. Returns null for anything this reader does not follow —
 * arrays, inline tables, and the opening line of a multi-line value.
 */
function readScalar(raw) {
    const value = raw.trim();
    if (value === "")
        return null;
    if (value.startsWith("[") || value.startsWith("{"))
        return null;
    const first = value[0];
    if (first === '"' || first === "'") {
        const closing = value.indexOf(first, 1);
        if (closing === -1)
            return null;
        return value.slice(0, closing + 1);
    }
    return value;
}
//# sourceMappingURL=toml-lite.js.map