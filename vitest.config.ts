import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@opap/core": fileURLToPath(
        new URL("./packages/opap-core/src/index.ts", import.meta.url),
      ),
      "@opap/runtime": fileURLToPath(
        new URL("./packages/opap-runtime/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      include: ["packages/*/src/**/*.ts"],
    },
    include: [
      "apps/**/test/**/*.test.ts",
      "packages/**/test/**/*.test.ts",
      "conformance/**/*.test.ts",
    ],
  },
});
