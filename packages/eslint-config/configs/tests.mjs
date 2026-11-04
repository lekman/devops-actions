/**
 * Test file overrides: relaxed rules for test files.
 *
 * @param {object} options
 * @param {string[]} [options.files] - Glob patterns for test files.
 * @returns {object} ESLint flat config object.
 */

export function tests({ files = ["**/*.test.ts", "**/tests/**/*.ts"] } = {}) {
  return {
    files,
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "jsdoc/check-alignment": "off",
      "no-console": "off",
      "no-undef": "off",
    },
  };
}
