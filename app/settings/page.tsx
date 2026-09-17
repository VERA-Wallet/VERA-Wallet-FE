import { redirect } from "next/navigation";
import { requireDidSession } from "@/lib/dal";
import { SettingsView } from "@/components/settings/settings-view";

export default async function SettingsPage() {
  // 설정 안의 항목(플랜·가리기 기본값·스팸 보기·로그아웃)은 모두 지갑 연결과 무관하다.
  // 그래서 플랜 화면과 같은 규칙으로 DID 세션만 요구한다(app/plan/page.tsx 참고).
  const session = await requireDidSession();
  if (!session) redirect("/login");

  return <SettingsView />;
}
