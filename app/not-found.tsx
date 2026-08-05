import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col justify-center px-5 py-8">
      <p className="text-sm font-semibold text-primary-500">VeraWallet</p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-900">없는 화면입니다</h1>
      <p className="mt-3 text-base leading-6 text-zinc-600">주소가 바뀌었거나 삭제된 화면일 수 있습니다.</p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-primary-500 py-3.5 font-semibold text-white"
      >
        거래 화면으로 이동
      </Link>
    </main>
  );
}
