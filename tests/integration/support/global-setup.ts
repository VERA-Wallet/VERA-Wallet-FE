import { startBackend, startNextServer, stopAll } from "./server-harness";

export default async function globalSetup() {
  // Stage 2부터 rewrite가 켜지므로 BE와 Next 서버 둘 다 필요하다.
  // Next는 반드시 VERAWALLET_BACKEND_ORIGIN을 갖고 떠야 한다 — rewrite는 프로세스 시작 시점에 한 번 고정된다.
  await startBackend({ port: 3200 });
  // 환율은 결정적 고정표로 — 통합 테스트가 외부 환율 API에 의존하면 CI가 네트워크에 흔들린다.
  // 골든(tests/fixtures/be-us-golden.json)도 같은 고정표(lib/adapters/fx/fixed-fx-rate.ts)로 만든 값이다.
  await startNextServer({ port: 3100, env: { VERAWALLET_BACKEND_ORIGIN: "http://localhost:3200", VERAWALLET_FX_SOURCE: "fixed" } });
  return async () => { await stopAll(); };
}
