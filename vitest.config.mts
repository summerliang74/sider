import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    exclude: [...configDefaults.exclude, ".tmp/**", "services/malware-scanner/**", "work/**"],
  },
});
