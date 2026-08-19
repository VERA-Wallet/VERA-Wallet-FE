import { redirect } from "next/navigation";
import { requireDidSession } from "@/lib/dal";

export default async function Home() {
  // 세션이 살아 있으면 로그인 화면을 다시 보여주지 않고 대시보드로 보낸다.
  // 세션 판정이 인프라 오류로 실패하면(예: ON 모드에서 BE 불가) 진입 자체를 막지 않고 로그인으로 보낸다.
  let authenticated = false;
  try {
    authenticated = Boolean(await requireDidSession());
  } catch {
    authenticated = false;
  }
  redirect(authenticated ? "/dashboard" : "/login");
}
