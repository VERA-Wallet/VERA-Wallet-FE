"use client";

import { useEffect, useState } from "react";

import { HttpReportVcClient, type ReportVcClient } from "@/lib/report-vc/client";

/**
 * 리포트 VC 클라이언트의 조립 지점.
 *
 * 기본은 HTTP(same-origin 프록시)다. mock 어댑터는 **명시적 로컬 미리보기**에서만 붙는다:
 * `NEXT_PUBLIC_REPORT_VC_PREVIEW=mock`이고 production 빌드가 아닐 때. 실서비스에서는 API 오류가
 * 그대로 "기능 준비 중"이나 오류로 보이고, mock 성공으로 바뀌지 않는다.
 *
 * `lib/composition-root.client.ts`에 넣지 않은 이유: 그 모듈을 통째로 mock하는 기존 화면 테스트가 많아,
 * 새 포트를 거기 더하면 그 테스트마다 더블을 추가해야 한다. 이 기능의 포트는 따로 조립한다.
 */
export function reportVcPreviewEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_REPORT_VC_PREVIEW === "mock";
}

let httpInstance: ReportVcClient | null = null;
let previewInstance: ReportVcClient | null = null;

function httpClient(): ReportVcClient {
  httpInstance ??= new HttpReportVcClient();
  return httpInstance;
}

/**
 * 화면이 쓸 클라이언트. `override`가 있으면 그것(테스트), 미리보기면 mock을 비동기로 불러오는 동안 null,
 * 그 외에는 HTTP 싱글턴이다. mock 코드는 미리보기에서만 로드되어 실서비스 번들에 들어가지 않는다.
 */
export function useReportVcClient(override?: ReportVcClient): ReportVcClient | null {
  const preview = override === undefined && reportVcPreviewEnabled();
  const [loaded, setLoaded] = useState<ReportVcClient | null>(previewInstance);
  useEffect(() => {
    if (!preview || previewInstance) return;
    let active = true;
    void import("@/lib/report-vc/mock").then(({ MockReportVcClient }) => {
      previewInstance ??= new MockReportVcClient({ settleAfterPolls: 2 });
      if (active) setLoaded(previewInstance);
    });
    return () => { active = false; };
  }, [preview]);
  if (override) return override;
  if (preview) return loaded;
  return httpClient();
}
