import Link from "next/link";
import { redirect } from "next/navigation";
import { DidLoginFlow } from "@/components/did/did-login-flow";
import { requireDidSession } from "@/lib/dal";
import { identityMode } from "@/lib/api-mode";

export default async function VerifyIdentityPage() {
  const session = await requireDidSession();
  if (!session) redirect("/login");
  const identity = await identityMode();
  const country = session.countryCode;
  const initialCountry = country === "US" || country === "UK" || country === "DE" ? country : "KR";
  return (
    <main className="flex min-h-dvh flex-col gap-6 px-5 py-8">
      <Link href="/settings#credential-wallet" className="text-sm underline underline-offset-4">증명서 지갑으로 돌아가기</Link>
      <h1 className="text-2xl font-bold">본인확인 다시 하기</h1>
      <p className="text-sm leading-6 text-zinc-600">증명서 지갑을 안전하게 연결하기 위해 최근 15분 이내의 모바일 신분증 인증이 필요합니다. 현재 계정과 같은 본인의 신분증으로 인증해 주세요. 완료하면 증명서 지갑 화면으로 돌아옵니다.</p>
      {identity.provider === "omnione_cx" ? (
        <DidLoginFlow provenance={identity.provenance} provider="omnione_cx" initialCountry={initialCountry} reauthentication />
      ) : (
        <p role="alert" className="text-sm text-zinc-600">현재 모바일 신분증 인증을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.</p>
      )}
    </main>
  );
}
