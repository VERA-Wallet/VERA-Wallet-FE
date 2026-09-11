import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // aside repl 번들 조각(header/footer/harness/specs)은 이어 붙여야 유효한 JS라 단독 lint 대상이 아니다.
    "tests/e2e-aside/**",
  ]),
]);

export default eslintConfig;
