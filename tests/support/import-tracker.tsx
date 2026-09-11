import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";

import { ImportTrackerProvider } from "@/components/wallet/import-tracker-provider";

/**
 * 불러오기 트래커가 살아 있는 화면을 그린다.
 *
 * 모달·칩·토스트는 이제 **같은 트래커 하나**를 구독하므로 테스트도 그 하나로 감싸야
 * "모달을 닫아도 폴링이 계속된다" 같은 사실을 검증할 수 있다. 단언마다 자기 래퍼를 만들면
 * 화면마다 다른 트래커가 생겨 검증하려던 사실 자체가 사라진다.
 */
export function renderWithImportTracker(ui: ReactNode, { strict = false }: { strict?: boolean } = {}) {
  // 재시도를 끄는 이유: 실패 경로를 볼 때 React Query가 조용히 한 번 더 시도하면
  // 테스트가 세는 요청 수와 화면이 말하는 상태가 어긋난다.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // `strict`는 개발 모드(앱의 기본값)를 흉내 낸다: 모든 effect가 마운트 → 정리 → 마운트로 두 번 돈다.
  // 화면에 도착하자마자 마커가 지워지던 버그는 이 이중 실행에서만 드러났다.
  const wrap = (children: ReactNode) => {
    const tree = (
      <QueryClientProvider client={queryClient}>
        <ImportTrackerProvider>{children}</ImportTrackerProvider>
      </QueryClientProvider>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
  const result = render(wrap(ui));
  return {
    ...result,
    queryClient,
    /**
     * 트래커는 그대로 두고 **화면만** 다시 그린다.
     *
     * RTL의 `rerender`를 그냥 쓰면 `render`에 넘겼던 트리 전체가 갈리면서 프로바이더까지 사라진다.
     * 그러면 구독자는 조용히 기본 트래커(진행 중인 불러오기 없음)로 떨어지고,
     * 테스트는 "마커가 지워졌다"가 아니라 "트래커가 사라졌다"를 보게 된다 — 통과해도 아무것도 지키지 못한다.
     */
    rerenderInTracker: (next: ReactNode) => result.rerender(wrap(next)),
  };
}
