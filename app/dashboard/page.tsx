import { redirect } from "next/navigation";
import { requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export default async function DashboardPage() {
  const session = await requireCompletedOnboarding();
  // 거주국은 DID 클레임에서 이미 확정됐다. 화면이 다시 묻지 않도록 서버에서 내려준다.
  if (session) return <DashboardView countryCode={session.countryCode} />;
  redirect(await requireDidSession() ? "/connect-wallet" : "/login");
}
