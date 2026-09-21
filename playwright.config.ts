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
      // 세금 화면의 통화 환산은 외부 환율 API(ECB) 대신 고정표를 쓴다 — e2e가 네트워크·환율 변동에 흔들리지 않게.
      VERAWALLET_FX_SOURCE: "fixed",
      // BE origin/main은 tax-evidence(묶음 등록)를 이미 구현하지만, 이 레인은 아직 ON으로 검증하지
      // 않았다 — 켜 두면 g002·g003의 다운로드 케이스가 등록 실패·타임아웃으로 깨질 수 있다.
      // 로컬에서 게이트를 켠 채 시험하려면 REPORT_ANCHOR_GATE=on pnpm test:e2e로 덮는다.
      REPORT_ANCHOR_GATE: process.env.REPORT_ANCHOR_GATE ?? "off",
      // 신원인증은 e2e에서 늘 mock QR 흐름이다. 개발 환경(.env.local)이 CX 인증창 주소를 갖고 있어도
      // 테스트가 라온 인증창(폰 필요)에 막히면 안 되므로 여기서 비운다. CX_MOCK=true로 켜는 쪽은 안 된다 —
      // `cxLoginEnabled()`가 그것까지 CX 흐름으로 치므로 버튼이 "모바일신분증으로 시작하기"로 바뀌어
      // 스펙이 누르는 "QR/딥링크 제시"가 사라진다. CI에는 .env.local이 없어 이 값이 곧 CI의 상태다.
      NEXT_PUBLIC_OMNIONE_CX_AUTH_URL: "",
      NEXT_PUBLIC_OMNIONE_CX_MOCK: "",
    },
  },
});
