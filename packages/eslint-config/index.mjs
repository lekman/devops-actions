/**
 * @lekman/eslint-config — shared ESLint flat config.
 *
 * Usage in eslint.config.mjs:
 *
 *   import { base, typescript, tests } from "@lekman/eslint-config";
 *
 *   export default [
 *     ...base(),
 *     typescript({ files: ["src/**\/*.ts"], tsconfigRootDir: import.meta.dirname }),
 *     tests({ files: ["src/**\/*.test.ts"] }),
 *   ];
 */

export { base } from "./configs/base.mjs";
export { COPYRIGHT_HEADER } from "./configs/copyright.mjs";
export { tests } from "./configs/tests.mjs";
export { typescript } from "./configs/typescript.mjs";
