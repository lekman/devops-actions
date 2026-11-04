/**
 * Base ESLint config: global ignores and recommended rules.
 *
 * @returns {Array} ESLint flat config array with ignores and recommended rules.
 */

import eslint from "@eslint/js";

export function base() {
  return [
    {
      ignores: [
        "dist/**",
        "node_modules/**",
        "build/**",
        "coverage/**",
        "**/*.js",
        "**/*.mjs",
        "**/tsconfig*.json",
      ],
    },
    // Prevent test files from being co-located with production code.
    // Tests belong in tests/ directory, not src/.
    {
      files: ["src/**/*.test.ts", "src/**/*.spec.ts"],
      rules: {
        "no-restricted-syntax": [
          "error",
          {
            selector: "Program",
            message:
              "Test files must live in tests/, not src/. Move this file to the tests/ directory.",
          },
        ],
      },
    },
    eslint.configs.recommended,
    {
      languageOptions: {
        globals: {
          Bun: "readonly",
          Response: "readonly",
          URL: "readonly",
          fetch: "readonly",
          setInterval: "readonly",
          clearInterval: "readonly",
          setTimeout: "readonly",
          clearTimeout: "readonly",
          console: "readonly",
          process: "readonly",
        },
      },
    },
  ];
}
