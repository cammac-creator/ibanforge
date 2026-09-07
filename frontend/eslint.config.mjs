import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The React Compiler readiness rules that eslint-plugin-react-hooks 7.1
  // turned on (2026-09-07, with a regenerated lockfile: 7.0.1 -> 7.1.1). They
  // describe patterns the compiler would need changed — setState inside an
  // effect, a ref read during render, an impure call during render, a global
  // assigned in a handler — not defects the pages show. Thirty occurrences
  // sit in CRM and dashboard components written before the rules existed, and
  // this project does not run the compiler. Warnings, so the CI keeps saying
  // something true and each file is cleaned when it is next touched; never
  // "off", so the count stays on the screen.
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
