import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/proxy-shadow-matrix.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": new URL("./", import.meta.url).pathname,
      "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname,
      "client-only": new URL("./tests/stubs/client-only.ts", import.meta.url).pathname,
    },
  },
});
