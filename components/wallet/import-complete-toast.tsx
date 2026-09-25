"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "@/components/ui/toast";
import { useImportTracker } from "@/components/wallet/import-tracker-provider";
import { importedEventCount } from "@/lib/wallet/import-tracker";

/**
 * 불러오기가 끝났다는 사실을 어느 탭에서든 알린다.
 *
 * 완료를 모달이 알리던 때에는, 모달을 걷고 다른 탭에 가 있으면 끝난 줄도 몰랐다.
 * 끝나는 시점은 사용자가 고르지 않으므로 알림이 사용자가 있는 곳으로 가야 한다.
 */
export function ImportCompleteToast() {
  const { state, dismissToast } = useImportTracker();
  const router = useRouter();
  const count = importedEventCount(state);

  const goToNewEvents = useCallback(() => {
    dismissToast();
    // 이미 원장 위에 있으면 화면을 갈아엎지 않고 새 거래로 데려간다 — 지금 보던 자리가 곧 맥락이다.
    const anchor = document.querySelector("[data-new-event]");
    if (anchor !== null) {
      anchor.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    router.push("/transactions");
  }, [dismissToast, router]);

  return (
    <Toast
      // 세는 중에는 뜨지 않는다. 먼저 0건이라 말한 뒤 수십 건으로 뒤집히면 어느 쪽이 사실인지 알 수 없다.
      open={state.status === "done" && !state.countingNew && !state.toastDismissed}
      // 0건도 결과다. "불러왔어요"라고만 하면 무엇이 들어왔는지 사용자가 원장에서 찾아 헤맨다.
      message={count > 0 ? `거래 ${count}건 조회 완료` : "새로 조회된 거래 없음"}
      actionLabel={count > 0 ? "보러 가기" : undefined}
      onAction={count > 0 ? goToNewEvents : undefined}
      onDismiss={dismissToast}
    />
  );
}
