import { redirect } from "next/navigation";
import { requireDidSession } from "@/lib/dal";
import { taxYearFor } from "@/lib/tax/engine";
import { PlanView } from "@/components/plan/plan-view";

export default async function PlanPage() {
  // 플랜은 지갑과 무관하다 — 무엇을 결제하는지 보려고 지갑부터 연결하게 만들 이유가 없다.
  // 그래서 온보딩 완료가 아니라 DID 세션만 요구한다.
  const didSession = await requireDidSession();
  if (!didSession) redirect("/login");

  // 결제 단위는 역년이 아니라 거주국의 과세연도다. 연도는 서버에서 내려준다 —
  // 클라이언트가 따로 시계를 읽으면 연말 자정 경계에서 서버 HTML과 hydration 결과가 갈린다.
  return <PlanView taxYear={taxYearFor(didSession.countryCode, new Date())} />;
}
