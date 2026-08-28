import { redirect } from "next/navigation";
import { requireDidSession } from "@/lib/dal";
import { WalletsView } from "@/components/wallet/wallets-view";
import { ImportProgressGate } from "@/components/dashboard/import-progress-gate";

// searchParams를 optional로 두는 이유: Next는 항상 넘기지만, 라우팅 가드 테스트는 인자 없이 이 함수를 부른다.
export default async function WalletsPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
} = {}) {
  // DID-only도 이 화면에 들어온다 — 연결된 지갑이 없다는 사실을 보여주는 것도 정보다.
  const session = await requireDidSession();
  if (!session) redirect("/login");

  // 지갑 탭에서 추가 등록한 직후(`?importing=1`)에는 대시보드와 동일한 불러오기 모달을 띄운다.
  // 모달은 `POST /api/events/resync` 응답으로 체인별 수집 건수를 그린다 — watch_only/siwe를 가리지 않고
  // 방금 추가한 바인딩까지 전체 재동기화가 돌기 때문이다. 게이트는 지갑 주소가 있을 때만 의미가 있다.
  const importing = (await searchParams)?.importing === "1";
  return (
    <>
      {importing && session.walletAddress ? <ImportProgressGate walletAddress={session.walletAddress} returnTo="/wallets" /> : null}
      {/* 등록 방법은 세션이 아는 사실이다. 화면이 자체 추측으로 검증 여부를 말하지 않도록 서버에서 내려준다. */}
      <WalletsView walletAddress={session.walletAddress} walletVerification={session.walletVerification ?? null} />
    </>
  );
}
