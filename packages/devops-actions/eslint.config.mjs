import { base, typescript } from "@lekman/eslint-config";

export default [
  { ignores: ["src/**/*.test.ts"] },
  ...base(),
  typescript({
    files: ["src/**/*.ts"],
    tsconfigRootDir: import.meta.dirname,
  }),
];
