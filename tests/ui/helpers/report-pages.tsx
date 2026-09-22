import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";

import { ReportBasis } from "@/components/report/report-basis";
import { ReportCompare } from "@/components/report/report-compare";
import { ReportInputsProvider } from "@/components/report/report-context";
import { ReportIssues } from "@/components/report/report-issues";
import { ReportMain } from "@/components/report/report-main";
import { ReportSettings } from "@/components/report/report-settings";

/**
 * 리포트가 다섯 화면(`/export`와 하위 넷)으로 나뉘면서, 한 화면을 렌더하던 테스트는
 * "그 섹션이 사는 페이지"를 렌더해야 한다. 프로바이더는 여전히 하나이므로 여러 페이지를
 * 함께 세워도 estimate는 한 벌이다 — 설정 화면에서 넣은 값이 메인 금액을 바꾸는지도
 * 이 헬퍼로 그대로 검증된다(프로덕션에서는 layout이 같은 프로바이더를 유지한다).
 */
const PAGES = {
  main: ReportMain,
  basis: ReportBasis,
  issues: ReportIssues,
  settings: ReportSettings,
  compare: ReportCompare,
} as const;

export type ReportPageName = keyof typeof PAGES;

const ALL_PAGES = ["main", "basis", "issues", "settings", "compare"] as const;

/**
 * 프로바이더의 실제 prop 타입. `ReportInputsOptions`(네 필드)로 좁혀 두면 프로바이더가 이미 받는
 * `provenance`조차 테스트에서 넘길 수 없다 — 프로바이더에 prop이 늘 때마다 여기를 따라 고치지 않아도 되게 한다.
 */
export type ReportPagesOptions = Omit<ComponentProps<typeof ReportInputsProvider>, "children">;

/** 프로바이더 + 고른 페이지들. `QueryClientProvider`는 호출부가 감싼다(테스트마다 client를 다루므로). */
export function ReportPages({
  pages = [...ALL_PAGES],
  children,
  ...options
}: ReportPagesOptions & { pages?: ReportPageName[]; children?: ReactNode }) {
  return (
    <ReportInputsProvider {...options}>
      {pages.map((name) => {
        const Page = PAGES[name];
        return <Page key={name} />;
      })}
      {children}
    </ReportInputsProvider>
  );
}

/** 흔한 경우를 한 줄로. 반환값에 client를 실어 `invalidateQueries` 같은 조작을 그대로 할 수 있게 한다. */
export function renderReportPages({
  pages,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  children,
  ...options
}: ReportPagesOptions & { pages?: ReportPageName[]; client?: QueryClient; children?: ReactNode } = {}) {
  const view = render(
    <QueryClientProvider client={client}>
      <ReportPages pages={pages} {...options}>
        {children}
      </ReportPages>
    </QueryClientProvider>,
  );
  return { ...view, client };
}
