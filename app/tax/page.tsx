import { redirect } from "next/navigation";

/**
 * 세금 화면은 리포트(`/export`)와 합쳐졌다.
 *
 * 북마크와 옛 링크가 끊기지 않게 그 자리로 보낸다. 인증 가드는 목적지가 그대로 갖고 있으므로
 * 여기서 다시 판정하지 않는다 — 두 곳에서 판정하면 규칙이 갈린다.
 * `redirect`는 렌더를 중단시키는 예외를 던지므로 `return`이 필요 없다(next/navigation 문서).
 */
export default function TaxPage() {
  redirect("/export");
}
