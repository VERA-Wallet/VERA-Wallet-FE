"use client";

import { createContext, useContext, useMemo, useState } from "react";

/**
 * 귀속연도(과세연도)의 단일 공유 소스.
 *
 * 예전에는 세금·대시보드·플랜이 taxYear를 각자 소유해, 세금 화면 셀렉터를 바꿔도
 * 대시보드·거래 상세는 옛 기간을 계속 보였다(desync). 선택된 연도를 여기 한 곳에 두고
 * 네 화면이 모두 구독한다. 앱 껍데기(app/providers.tsx)에 얹으므로 소프트 내비게이션으로
 * 화면을 옮겨도 선택이 유지된다.
 *
 * `null`은 "사용자가 아직 고르지 않음"이다 — 그때 각 화면은 자기 기본값(마지막 활동연도)을
 * 그대로 쓴다. 초기값 규칙은 하나(마지막 활동연도)이고, 사용자가 고른 순간부터 그 선택이
 * 모든 화면을 덮는다. 서버·하이드레이션 모두 `null`에서 시작하므로 SSR과 갈리지 않는다.
 */
type TaxYearContextValue = { selectedYear: number | null; selectYear: (year: number) => void };

const TaxYearContext = createContext<TaxYearContextValue | null>(null);

export function TaxYearProvider({ children }: { children: React.ReactNode }) {
  const [selectedYear, selectYear] = useState<number | null>(null);
  const value = useMemo(() => ({ selectedYear, selectYear }), [selectedYear]);
  return <TaxYearContext.Provider value={value}>{children}</TaxYearContext.Provider>;
}

/**
 * 선택된 귀속연도와 그 세터.
 *
 * @param fallbackYear 사용자가 아직 고르지 않았을 때 쓸 기본 연도(화면마다 마지막 활동연도로 파생).
 *
 * 프로바이더가 있으면 공유 선택을 구독한다 — 한 화면에서 바꾸면 나머지도 같은 연도를 본다.
 * 프로바이더가 없으면(컴포넌트를 격리해 렌더하는 테스트) 로컬 상태로 물러나 예전 동작을 그대로 지킨다.
 * 훅은 조건 없이 늘 호출한다 — 로컬 상태는 프로바이더가 없을 때만 쓰인다.
 */
export function useTaxYear(fallbackYear: number): [number, (year: number) => void] {
  const shared = useContext(TaxYearContext);
  const [localYear, setLocalYear] = useState<number | null>(null);
  if (shared) return [shared.selectedYear ?? fallbackYear, shared.selectYear];
  return [localYear ?? fallbackYear, setLocalYear];
}
