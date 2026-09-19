"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ImportProgressModal } from "@/components/wallet/import-progress-modal";
import { useImportElapsed, useImportTracker } from "@/components/wallet/import-tracker-provider";
import { IMPORT_DONE_HOLD_MS } from "@/lib/wallet/import-progress";
import { importProgressFrom, importScanChains } from "@/lib/wallet/import-tracker";

/**
 * `?importing=1`로 들어왔을 때만 불러오기 모달을 띄우고, 끝나면 스스로 걷어낸다.
 *
 * **진행을 소유하지 않는다.** 폴링·완료 판정·캐시 무효화는 앱 껍데기의 불러오기 트래커가 한다.
 * 예전에는 이 컴포넌트의 effect가 `runImportSync`를 돌렸고, "백그라운드에서 계속"으로 모달을 걷으면
 * effect 정리가 폴링을 끊어 완료 시점의 캐시 무효화가 영영 일어나지 않았다 —
 * BE는 새 거래를 다 넣었는데 대시보드는 staleTime 동안 옛 원장을 보여줬다.
 * 이제 모달은 트래커의 구독자일 뿐이라, 닫는 것은 **보기를 그만두는 것**이지 취소가 아니다.
 *
 * 단계 애니메이션은 연출(타이머)이지만 **완료·실패는 실제 응답에서만** 나온다 —
 * 그 합성은 `importProgressFrom`이 한 곳에서 하고, 칩·진행 시트도 같은 함수를 쓴다.
 *
 * 진입 여부는 서버(`app/dashboard/page.tsx`)가 `searchParams`로 판정해 이 컴포넌트를 아예 렌더하지 않으므로,
 * 여기서는 `useSearchParams`를 쓰지 않는다 — Suspense 경계도 필요 없다.
 *
 * 닫을 때 `replace`로 쿼리를 지운다. `push`면 뒤로가기가 방금 끝난 불러오기 화면을 되살린다.
 * `returnTo`가 닫힘 목적지다 — 온보딩은 대시보드, 지갑 탭 추가는 왔던 지갑 탭으로 돌아가야 한다.
 */
export function ImportProgressGate({ walletAddress, returnTo = "/dashboard" }: { walletAddress: string; returnTo?: string }) {
  const router = useRouter();
  const { state, start, retry, setModalOpen } = useImportTracker();
  const [dismissed, setDismissed] = useState(false);

  // 이 화면에 들어온 것 자체가 시작 신호다. 이미 돌고 있으면 `start`는 아무 일도 하지 않으므로
  // 리렌더나 개발 모드의 이중 실행이 작업을 두 번 접수하지 않는다.
  useEffect(() => {
    start(walletAddress);
  }, [start, walletAddress]);

  // 모달이 떠 있는 동안에는 칩이 같은 사실을 겹쳐 말하지 않게 한다.
  useEffect(() => {
    setModalOpen(!dismissed);
    return () => setModalOpen(false);
  }, [dismissed, setModalOpen]);

  // 응답이 오면 체인 목록이 사실(수집 건수)로 바뀐다. 그 전에는 지원 체인 전체를 건수 없이 보여주되,
  // BE가 진행 중 보고한 체인은 끝나는 대로 건수가 붙는다.
  const reported = state.job?.progress ?? null;
  const chains = useMemo(() => importScanChains(state.result, reported, walletAddress), [state.result, reported, walletAddress]);
  const elapsedMs = useImportElapsed(state.startedAt);
  // 이 모달은 방금 연결한 지갑의 것이다 — 작업이 다른 지갑도 돌더라도 이 지갑의 체인만 말한다.
  const progress = importProgressFrom(state.status, elapsedMs, chains.length, reported, walletAddress);

  // 완료 표시를 잠깐 보여준 뒤 스스로 닫는다. 사용자가 버튼을 눌러야 사라지면
  // 자리를 비운 사이 끝난 불러오기가 대시보드를 계속 가린다.
  useEffect(() => {
    if (dismissed || progress.phase !== "done") return;
    const timeout = window.setTimeout(() => {
      setDismissed(true);
      router.replace(returnTo);
    }, IMPORT_DONE_HOLD_MS);
    return () => window.clearTimeout(timeout);
  }, [dismissed, progress.phase, router, returnTo]);

  return (
    <ImportProgressModal
      open={!dismissed}
      progress={progress}
      walletAddress={walletAddress}
      chains={chains}
      onBackground={() => {
        // 모달만 걷는다. 폴링도 작업도 그대로 간다 — 끝나면 칩과 토스트가 이어서 말한다.
        setDismissed(true);
        router.replace(returnTo);
      }}
      onRetry={retry}
    />
  );
}
