"use client";

import { useEffect } from "react";

export default function RouteError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col justify-center px-5 py-8">
      <p className="text-sm font-semibold text-primary-500">VeraWallet</p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-900">화면을 불러오지 못했습니다</h1>
      <p className="mt-3 text-base leading-6 text-zinc-600">
        일시적인 문제일 수 있습니다. 다시 시도하거나 잠시 후 접속해 주세요.
      </p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-zinc-400">code: {error.digest}</p> : null}
      <button
        type="button"
        className="mt-6 w-full rounded-xl bg-primary-500 py-3.5 font-semibold text-white"
        onClick={() => unstable_retry()}
      >
        다시 시도
      </button>
    </main>
  );
}
