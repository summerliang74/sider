import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["backend/src/main/resources/static/**/*.js"],
    rules: {
      // These pages use native browser navigation and do not run inside Next.js.
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
  globalIgnores([".next/**", "frontend-prototype/**", ".tmp/**", "work/**"]),
]);
