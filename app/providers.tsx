"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wallet/wagmi-config";
import { TaxYearProvider } from "@/lib/tax/tax-year-context";
import { ImportTrackerProvider } from "@/components/wallet/import-tracker-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  // 기본값(staleTime 0·포커스 재조회)이면 탭을 오가거나 창을 클릭할 때마다 이벤트 13페이지·요약·세금 추정을 전부 다시 받는다.
  // 원장은 분 단위로만 바뀌는 데이터라 1분은 신선하다고 본다. 실제로 바뀌는 순간(재분류·값 입력·동기화 완료)은
  // 각 뮤테이션과 불러오기 게이트가 명시적으로 무효화한다 — 시간이 아니라 사실이 갱신을 만든다.
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 } },
  }));

  return (
    <WagmiProvider config={wagmiConfig}>
      {/* 귀속연도는 화면을 옮겨도 유지돼야 한다 — 껍데기에 얹어 세금·대시보드·플랜이 한 소스를 구독한다. */}
      {/*
        브라우저 지갑의 활성 계정이 바뀌어도 세션을 끊지 않는다. 신원은 DID 세션 쿠키가 쥐고 지갑은 그 아래
        SIWE로 등록된 별도 바인딩이라, 확장 프로그램에서 계정을 옮기는 것은 등록된 지갑을 무효화하지 않는다.
        화면의 거래도 활성 계정이 아니라 등록된 지갑 전체에서 오므로 계정 전환이 데이터를 오해하게 만들지도 않는다.
      */}
      {/*
        불러오기 폴링은 화면이 아니라 껍데기가 쥔다. 모달이 쥐고 있던 동안에는 "백그라운드에서 계속"이
        폴링을 끊어, 완료 시점에만 할 수 있는 캐시 무효화가 영영 일어나지 않았다.
        QueryClient 안쪽에 둬야 완료 순간 원장·요약·세금 캐시를 직접 무효화할 수 있다.
      */}
      <QueryClientProvider client={queryClient}>
        <ImportTrackerProvider>
          <TaxYearProvider>{children}</TaxYearProvider>
        </ImportTrackerProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
