import { redirect } from "next/navigation";
import { requireDidSession } from "@/lib/dal";
import { WalletsView } from "@/components/wallet/wallets-view";

export default async function WalletsPage() {
  // DID-only도 이 화면에 들어온다 — 연결된 지갑이 없다는 사실을 보여주는 것도 정보다.
  const session = await requireDidSession();
  if (!session) redirect("/login");
  return <WalletsView walletAddress={session.walletAddress} chainId={session.chainId} />;
}
