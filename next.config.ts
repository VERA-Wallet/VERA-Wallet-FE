import type { NextConfig } from "next";

// BE 프록시는 `proxy.ts`가 담당한다. 여기서 rewrite로 하지 않는 이유 두 가지:
// 1) external rewrite는 원 요청 헤더를 그대로 전달해 `vw_session` 같은 FE 전용 쿠키까지 BE로 나간다.
// 2) rewrite는 `.next/routes-manifest.json`에 빌드 시점으로 박혀, OFF로 빌드한 산출물에 env만 켜면
//    인증은 ON인데 브라우저 이벤트 경로는 FE mock인 혼합 모드가 된다.

// 원격 브라우저(공인 IP·터널 호스트)로 dev 서버를 열면 Next가 HMR 같은 dev 전용 엔드포인트의
// 교차 출처 요청을 막는다. 허용 호스트는 코드에 박지 않고 `.env.local`의
// VERAWALLET_DEV_ALLOWED_ORIGINS(쉼표 구분 호스트명, 포트 없음)로 준다. 비우면 기존처럼 localhost 전용이다.
const devAllowedOrigins = (process.env.VERAWALLET_DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

// proxy.ts가 BE로 넘기는 외부 rewrite는 Next의 프록시 타임아웃(기본 30초)을 탄다. `POST /api/events/resync`는
// 지갑 하나의 최초 동기화가 체인 5개 수집과 CoinGecko 과거 시세 조회를 동기로 끝내야 응답하므로 30초를 쉽게 넘기고,
// 그러면 BE는 뒤에서 정상 완료하는데 불러오기 모달만 "다 불러오지 못했습니다"로 끝난다(2026-09-08 실지갑 검증에서 35초 관측).
// 동기화를 비동기 작업+폴링으로 바꾸기 전까지의 완화책이다.
// Docker 이미지는 `.next/standalone`(서버 실행에 필요한 파일만)을 쓴다. 항상 켜 두지 않는 이유:
// `output: "standalone"`이면 `next start`가 경고를 내고, 로컬 dev/CI는 standalone을 쓸 일이 없다.
// Dockerfile이 NEXT_OUTPUT=standalone을 주고 빌드한다.
const nextConfig: NextConfig = {
  ...(devAllowedOrigins.length > 0 ? { allowedDevOrigins: devAllowedOrigins } : {}),
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  experimental: { proxyTimeout: 180_000 },
};

export default nextConfig;
