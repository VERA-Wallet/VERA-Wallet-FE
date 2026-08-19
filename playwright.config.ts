import { defineConfig } from "@playwright/test";

import { backendOrigin } from "./lib/api-mode";

const EFFECTIVE_ORIGIN = backendOrigin();

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: 0,
  // in-memory 저장소(FE mock 또는 BE)를 공유하므로 파일 간 병렬 실행은 상태 경합을 만든다.
  workers: 1,
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // rewrite는 프로세스 시작 시점에 고정된다. ON 모드로 돌리려면 이 서버가 그 env를 갖고 떠야 한다.
    command: "pnpm exec next dev -p 3100",
    url: "http://localhost:3100",
    // ON 모드에서 이전 실행이 남긴 OFF 서버에 붙으면 조용히 다른 계약을 검증하게 된다.
    // VERAWALLET_MOCK_MODE=true 강제 시 하네스가 ON으로 오분류하면 스폰된 서버와 테스트가 다른 계약을 본다.
    reuseExistingServer: !process.env.CI && !EFFECTIVE_ORIGIN,
    timeout: 120_000,
    env: {
      ...(EFFECTIVE_ORIGIN ? { VERAWALLET_BACKEND_ORIGIN: EFFECTIVE_ORIGIN } : {}),
      ...(process.env.VERAWALLET_MOCK_MODE ? { VERAWALLET_MOCK_MODE: process.env.VERAWALLET_MOCK_MODE } : {}),
    },
  },
});
