"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ImportProgressModal, useMockImportProgress } from "@/components/wallet/import-progress-modal";
import { demoWalletChains } from "@/lib/wallet/holdings";
import { IMPORT_DONE_HOLD_MS, isEvmChain } from "@/lib/wallet/import-progress";

/**
 * 훑을 체인. **보유 자산이 있는 EVM 체인만** 남긴다 — 지금 인식하는 것은 EVM뿐이고,
 * 잔액이 없는 체인을 훑는 것은 사용자에게도 인덱서에도 낭비다.
 *
 * 지금은 데모 보유 자산에서 파생한다. 실 잔액 API가 붙으면 이 한 줄만 그 조회로 바뀐다.
 */
const SCAN_CHAINS = demoWalletChains().filter((chain) => isEvmChain(chain.chainId));

/**
 * `/dashboard?importing=1`로 들어왔을 때만 불러오기 모달을 띄우고, 끝나면 스스로 걷어낸다.
 *
 * 모달 상태를 `DashboardView`에 넣지 않는 이유: 대시보드 본문은 불러오기와 아무 관계가 없고,
 * 거기에 라우터 의존을 심으면 대시보드를 렌더하는 모든 테스트가 라우터 컨텍스트를 요구하게 된다.
 * 진입 여부는 서버(`app/dashboard/page.tsx`)가 `searchParams`로 판정해 이 컴포넌트를 아예 렌더하지 않으므로,
 * 여기서는 `useSearchParams`를 쓰지 않는다 — Suspense 경계도 필요 없다.
 *
 * 닫을 때 `replace`로 쿼리를 지운다. `push`면 뒤로가기가 방금 끝난 불러오기 화면을 되살린다.
 */
export function ImportProgressGate({ walletAddress }: { walletAddress: string }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const progress = useMockImportProgress(!dismissed, SCAN_CHAINS.length);

  // 완료 표시를 잠깐 보여준 뒤 스스로 닫는다. 사용자가 버튼을 눌러야 사라지면
  // 자리를 비운 사이 끝난 불러오기가 대시보드를 계속 가린다.
  useEffect(() => {
    if (dismissed || progress.phase !== "done") return;
    const timer = window.setTimeout(() => {
      setDismissed(true);
      router.replace("/dashboard");
    }, IMPORT_DONE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [dismissed, progress.phase, router]);

  return (
    <ImportProgressModal
      open={!dismissed}
      progress={progress}
      walletAddress={walletAddress}
      chains={SCAN_CHAINS}
      onBackground={() => {
        setDismissed(true);
        router.replace("/dashboard");
      }}
    />
  );
}
