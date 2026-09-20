import Link from "next/link";

/**
 * "없는 것"을 말하는 화면. error.tsx와 같은 어휘(눈썹 라벨·제목·본문·code·전폭 버튼)를 쓴다.
 * 탭바는 layout이 그대로 그리므로 돌아갈 길이 남는다. 거래 내역과 지갑은 그대로라는 사실을 함께 말한다.
 */
export function NotFoundView({
  title = "페이지를 찾을 수 없습니다",
  body = "주소가 바뀌었거나 없는 페이지입니다. 거래 내역과 지갑은 그대로 있으니 아래에서 이동해 주세요.",
  code,
}: {
  title?: string;
  body?: string;
  /** 사용자가 지원 요청에 붙일 수 있는 식별자(경로·주소). */
  code?: string;
}) {
  return (
    <main data-surface="not-found" className="flex min-h-dvh flex-col justify-center px-5 py-8">
      <p className="text-sm font-semibold text-primary-500">VeraWallet</p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-900">{title}</h1>
      <p className="mt-3 text-base leading-6 text-zinc-600">{body}</p>
      <p className="mt-2 break-all font-mono text-xs text-zinc-400">code: 404{code ? ` · ${code}` : ""}</p>
      <Link href="/dashboard" className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-primary-500 py-3.5 font-semibold text-white">
        거래로 이동
      </Link>
      <Link href="/wallets" className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-zinc-200 bg-white py-3.5 font-semibold text-zinc-900">
        지갑 목록
      </Link>
    </main>
  );
}
