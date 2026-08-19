import { test } from "@playwright/test";
import { backendOrigin } from "../../../lib/api-mode";

import { startBackend, stopBackend } from "../../integration/support/server-harness";

/**
 * 스펙 파일마다 BE를 재기동해 인메모리 상태를 초기화한다.
 *
 * BE `MockIdentityAdapter`는 입력 token을 무시하고 항상 같은 didHash를 반환한다 — 즉 모든 DID 제시가 같은 user다.
 * 그래서 스펙마다 지갑 프라이빗키를 바꿔도 격리되지 않는다(먼저 실행된 스펙이 바인딩한 지갑이 그대로 남아,
 * 뒤 스펙의 "DID만 있고 지갑은 없는" 전제를 깨뜨린다). 프로세스 재기동만이 유일한 격리 수단이다.
 *
 * 실효 mock 모드에서는 BE 자체가 필요 없으므로 아무것도 하지 않는다.
 */
export function useFreshBackend(): void {
  if (!backendOrigin()) return;

  test.beforeAll(async () => {
    // 정리 실패를 삼키면 옛 BE가 살아 있는 채로 다음 스펙이 green이 된다.
    // stopBackend()는 PID 기록이 없으면 이미 no-op이므로 여기서 따로 봐줄 필요가 없다.
    await stopBackend();
    await startBackend({ port: 3200 });
  });

  test.afterAll(async () => {
    await stopBackend();
  });
}
