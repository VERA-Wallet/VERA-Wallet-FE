import { startBackend, startNextServer, stopAll } from "./server-harness";

export default async function globalSetup() {
  // Stage 2부터 rewrite가 켜지므로 BE와 Next 서버 둘 다 필요하다.
  // Next는 반드시 VERAWALLET_BACKEND_ORIGIN을 갖고 떠야 한다 — rewrite는 프로세스 시작 시점에 한 번 고정된다.
  await startBackend({ port: 3200 });
  await startNextServer({ port: 3100, env: { VERAWALLET_BACKEND_ORIGIN: "http://localhost:3200" } });
  return async () => { await stopAll(); };
}
