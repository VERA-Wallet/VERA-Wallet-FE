import { notFound, redirect } from "next/navigation";
import { requireDidSession } from "@/lib/dal";
import { EvidenceView } from "@/components/export/evidence-view";

const MERKLE_ROOT = /^0x[0-9a-fA-F]{64}$/;

/**
 * 체인에 봉인한 계산 근거 하나. 리포트의 "체인에서 직접 확인"이 여기로 온다.
 *
 * 루트 형식만 여기서 거른다(형식이 아니면 404). 이 계정의 기록인지는 서버가 문서를 돌려줄 때 판정한다 —
 * 남의 루트를 넣으면 not_found가 오고, 화면은 "기록을 찾지 못했습니다"를 말한다.
 */
export default async function EvidencePage({ params }: { params: Promise<{ merkleRoot: string }> }) {
  const { merkleRoot } = await params;
  if (!MERKLE_ROOT.test(merkleRoot)) notFound();
  const session = await requireDidSession();
  if (!session) redirect("/login");
  return <EvidenceView merkleRoot={merkleRoot} />;
}
