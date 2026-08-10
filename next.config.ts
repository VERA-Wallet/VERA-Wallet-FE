import type { NextConfig } from "next";

// BE 프록시는 `proxy.ts`가 담당한다. 여기서 rewrite로 하지 않는 이유 두 가지:
// 1) external rewrite는 원 요청 헤더를 그대로 전달해 `vw_session` 같은 FE 전용 쿠키까지 BE로 나간다.
// 2) rewrite는 `.next/routes-manifest.json`에 빌드 시점으로 박혀, OFF로 빌드한 산출물에 env만 켜면
//    인증은 ON인데 브라우저 이벤트 경로는 FE mock인 혼합 모드가 된다.
const nextConfig: NextConfig = {};

export default nextConfig;
