import { redirect } from "next/navigation";
import { requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { TaxSimulator } from "@/components/tax/tax-simulator";

export default async function TaxPage() {
  const session = await requireCompletedOnboarding();
  // 거주국은 DID 클레임에서 확정됐다. 화면이 "어느 나라?"부터 묻지 않도록 서버에서 내려준다.
  // 연도도 서버에서 내려준다. 클라이언트가 따로 시계를 읽으면
  // 연말 자정 경계에서 서버 HTML과 hydration 결과가 갈린다.
  if (session) return <TaxSimulator countryCode={session.countryCode} currentYear={new Date().getFullYear()} />;
  redirect(await requireDidSession() ? "/connect-wallet" : "/login");
}
