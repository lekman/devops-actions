/**
 * TypeScript ESLint config: parser, plugins, and rules for production code.
 *
 * @param {object} options
 * @param {string[]} [options.files] - Glob patterns for files to lint.
 * @param {string} options.tsconfigRootDir - Absolute path to tsconfig directory.
 * @returns {object} ESLint flat config object.
 */

import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import eslintConfigPrettier from "eslint-config-prettier";
import headers from "eslint-plugin-headers";
import importPlugin from "eslint-plugin-import-x";
import jsdoc from "eslint-plugin-jsdoc";
import prettier from "eslint-plugin-prettier";

import { COPYRIGHT_HEADER } from "./copyright.mjs";

export function typescript({
  files = ["**/*.{ts,tsx}"],
  tsconfigRootDir,
} = {}) {
  return {
    files,
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: true,
        tsconfigRootDir,
        warnOnUnsupportedTypeScriptVersion: false,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      headers,
      import: importPlugin,
      jsdoc,
      prettier,
    },
    rules: {
      // --- TypeScript ---
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-shadow": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "no-unused-vars": "off",
      "no-shadow": "off",

      // --- Prettier ---
      "prettier/prettier": ["error", {}, { usePrettierrc: true }],

      // --- Copyright header ---
      "headers/header-format": [
        "error",
        {
          source: "string",
          content: COPYRIGHT_HEADER,
          trailingNewlines: 2,
        },
      ],

      // --- Import ordering ---
      "import/no-duplicates": "error",
      "import/no-useless-path-segments": "error",
      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling"],
            "index",
            "type",
          ],
          // Explicitly classify TypeScript path-aliased imports as `internal`
          // so the rule does not depend on the TS resolver being loaded. With
          // a resolver, `@domain/*` resolves to a local path and is internal;
          // without it, the plugin treats `@domain/*` as a scoped external
          // package and alphabetizes `@` before `b`. pathGroups removes the
          // ambiguity — same answer in local dev and CI.
          pathGroups: [
            {
              pattern: "node:**",
              group: "builtin",
              position: "before",
            },
            {
              pattern: "@{domain,application,infrastructure,interface}/**",
              group: "internal",
              position: "before",
            },
          ],
          pathGroupsExcludedImportTypes: ["type"],
          "newlines-between": "never",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],

      // --- JSDoc (lightweight — TypeScript types are the primary contract) ---
      "jsdoc/check-alignment": "warn",
      "jsdoc/check-tag-names": "warn",

      // --- General ---
      "no-console": "warn",

      // --- Disable rules that conflict with Prettier ---
      ...eslintConfigPrettier.rules,
    },
  };
}
