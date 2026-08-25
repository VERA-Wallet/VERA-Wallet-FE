/**
 * 브라우저 지갑 표식(중립).
 *
 * 특정 지갑(메타마스크 등) 로고를 흉내 내지 않는다 — 어떤 지갑 앱으로 연결했는지 모르므로(주소만 안다)
 * 중립 표식 하나로 "브라우저 지갑"이라는 연결 방식만 나타낸다. 포트폴리오 헤더와 계정 화면이 함께 쓴다.
 */
export function WalletMark({ size = 36 }: { size?: number }) {
  return (
    <svg aria-hidden="true" className="shrink-0" width={size} height={size} viewBox="0 0 32 32">
      <rect width="32" height="32" rx="10" fill="#3F3F46" />
      <path
        d="M9 12a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2Z"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="20.5" cy="18" r="1.2" fill="#fff" />
    </svg>
  );
}
