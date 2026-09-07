import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The React Compiler readiness rules that eslint-plugin-react-hooks 7.1
  // turned on (2026-09-07, with a regenerated lockfile: 7.0.1 -> 7.1.1). They
  // were downgraded to warnings the same day to keep the CI green over thirty
  // occurrences in CRM and dashboard components written before the rules
  // existed. The count came back to zero on 2026-09-07 and they are errors
  // again: what is left of the old code is two disables, each on its line with
  // its reason (a cookie written from a click, a countdown a server component
  // must read off the clock). A third would now break the build, which is the
  // point.
  {
    rules: {
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/refs": "error",
      "react-hooks/purity": "error",
      "react-hooks/immutability": "error",
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
