import { ShieldCheck, Wallet } from "lucide-react";
import { redirect } from "next/navigation";
import { requireDidSession } from "@/lib/dal";
import { DidLoginFlow } from "@/components/did/did-login-flow";
import { identityMode } from "@/lib/api-mode";

export default async function LoginPage() {
  // 이미 인증된 세션이면 로그인 단계를 건너뛴다 — 새로고침·재방문마다 다시 로그인하지 않도록.
  // 세션 판정이 인프라 오류로 실패하면 로그인 화면을 그대로 보여준다(로그인 진입을 막지 않는다).
  let authenticated = false;
  try {
    authenticated = Boolean(await requireDidSession());
  } catch {
    authenticated = false;
  }
  if (authenticated) redirect("/dashboard");
  const identity = await identityMode();

  return (
    <main className="flex min-h-dvh flex-col px-5 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
          지갑 거래를 정리하고
          <br />
          2027년 과세를 미리 계산해요
        </h1>
        {/* 설명은 문단이 아니라 두 줄 목록이다. 시작 버튼이 화면 아래에 붙으므로(엄지가 닿는 자리) 제목과 버튼 사이가
            길어지는데, 그 자리를 "이 앱이 뭘 해 주나"와 "왜 신분증인가"가 채운다 — 예전처럼 빈 채로 두지 않는다. */}
        <ul className="mt-8 grid grid-cols-1 gap-5">
          <li className="flex items-start gap-3">
            <Wallet aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-primary-500" strokeWidth={1.8} />
            <p className="text-sm leading-6 text-zinc-600">
              <span className="block text-base font-semibold text-zinc-900">지갑 주소만 있으면 돼요</span>
              지갑 주소로 거래를 불러와 자동으로 분류해요.
            </p>
          </li>
          <li className="flex items-start gap-3">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-primary-500" strokeWidth={1.8} />
            <p className="text-sm leading-6 text-zinc-600">
              <span className="block text-base font-semibold text-zinc-900">거주 국가에 맞는 규칙으로 계산해요</span>
              처음 한 번 모바일신분증으로 본인 확인을 해요.
            </p>
          </li>
        </ul>
      </div>
      {/* 시작 카드는 화면 **아래**에 붙는다(`mt-auto`). 한 손으로 쥔 폰에서 엄지가 닿는 자리이고, 위에 두면
          긴 화면에서 버튼 아래가 통째로 빈다. 내용이 화면보다 길어지면 auto 여백은 0이 되어 자연히 이어진다. */}
      <div className="mt-auto pt-10">
        <DidLoginFlow provenance={identity.provenance} provider={identity.provider} />
      </div>
    </main>
  );
}
