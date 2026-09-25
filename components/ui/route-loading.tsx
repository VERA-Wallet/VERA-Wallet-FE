export function RouteLoading() {
  return (
    <main className="min-h-[60dvh]" aria-busy="true">
      <div
        role="status"
        className="pointer-events-none fixed inset-0 z-10 flex flex-col items-center justify-center gap-5 px-5"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 48 48"
          className="size-12 animate-spin text-primary-500 motion-reduce:animate-none"
          fill="none"
        >
          <circle cx="24" cy="24" r="19" stroke="currentColor" strokeWidth="4" opacity="0.15" />
          <path
            d="M24 5a19 19 0 0 1 19 19"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
        <p className="text-center text-lg font-bold text-zinc-800">화면을 불러오는 중입니다.</p>
      </div>
    </main>
  );
}
