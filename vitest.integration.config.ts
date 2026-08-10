import { defineConfig } from "vitest/config";

// mergeConfig는 쓰지 않는다. Vite 8의 mergeConfigRecursively는 배열을 치환하지 않고 연결하므로 base의 tests/integration/** exclude가 남아 통합 테스트를 수집하지 못한다.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/support/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Stage 2의 route-table.test.ts가 파일 끝에서 BE를 재기동하므로, 병렬이면 다른 파일이 같은 3200 인스턴스를 건드려 비결정적으로 깨진다.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      "@": new URL("./", import.meta.url).pathname,
      "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname,
      "client-only": new URL("./tests/stubs/client-only.ts", import.meta.url).pathname,
    },
  },
});
