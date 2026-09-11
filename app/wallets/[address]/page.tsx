import { notFound, redirect } from "next/navigation";
import { requireDidSession } from "@/lib/dal";
import { WalletHome } from "@/components/wallet/wallet-home";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * 지갑 하나의 포트폴리오. 주소 형식만 여기서 거른다(형식이 아니면 404).
 * 이 계정에 등록된 주소인지는 클라이언트가 지갑 목록으로 판정한다 — 세션은 최신 지갑 하나만 알기 때문이다.
 */
export default async function WalletDetailPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!EVM_ADDRESS.test(address)) notFound();
  const session = await requireDidSession();
  if (!session) redirect("/login");
  return <WalletHome walletAddress={address} />;
}
