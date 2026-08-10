import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "tests/integration/**", "node_modules/**"],
    setupFiles: ["tests/setup.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": new URL("./", import.meta.url).pathname,
      "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname,
      "client-only": new URL("./tests/stubs/client-only.ts", import.meta.url).pathname,
    },
  },
});
