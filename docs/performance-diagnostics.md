# UX 시간 측정

브라우저 진단은 `https://verawallet.pelicanlab.dev/login?perf=1`로 열면 켜진다. 로그인된 화면에는 `?perf=1`을 붙여 새로 열어도 된다. 이후 같은 브라우저에서 계속 유지한다. DevTools Console에서 `window.veraPerformance.snapshot()`으로 최근 500건을 확인하고 `copy(JSON.stringify(window.veraPerformance.snapshot()))`으로 복사할 수 있다. `window.veraPerformance.disable()`로 끄고 기록을 지운다. 서버 전송이나 영구 기록 저장은 하지 않는다. 새로고침하면 측정 목록은 새로 시작한다.

| 항목 | 의미 |
| --- | --- |
| resource | 브라우저 리소스·API 전체 요청 시간. 서버 `Server-Timing`도 함께 기록 |
| navigation | 최초 페이지 탐색 시간 |
| route_commit | Next 라우터 이동 시작부터 해당 경로 React effect까지. 데이터·화면 전체 로딩 완료는 아님 |
| largest-contentful-paint | 최초 화면의 가장 큰 콘텐츠가 표시된 시각 |
| longtask | 메인 스레드에서 50ms 이상 걸린 작업 |
| wallet.connect_approval / wallet.sign_approval | 지갑 호출부터 승인·거절 반환까지. 앱 이동·사람의 대기 시간 포함 |
| cx.interactive_flow | CX 인증창 열기부터 반환까지. SDK 로드와 사용자 승인 모두 포함 |
| did.presentation_wait / vc.*_wait | QR 표시 후 폴링 시작부터 완료·오류·이탈까지. 사람의 승인과 폴링 간격 포함 |

URL의 쿼리·fragment·계정·시도 ID는 기록하지 않는다. 요청·응답 본문, 쿠키, 인증 토큰, 서명도 기록하지 않는다. 새 기능의 경로는 허용된 고정 문자열 이외를 `:id`로 줄인다. 따라서 여러 정적 파일도 같은 이름으로 보일 수 있다.

## 서버

BE API 응답의 `Server-Timing`:
- `backend`: BE 미들웨어 진입부터 응답 헤더 작성까지.
- `did_issuer_headers`, `did_verifier_headers`, `cx_headers`, `omnione_chain_headers`, `external_headers`: 해당 요청 안에서 Node fetch 호출부터 응답 헤더 수신까지 합계. 응답 본문 읽기는 포함하지 않는다. 병렬 호출 합계가 backend보다 클 수 있으므로 두 수치를 빼서 자체 처리 시간을 계산하면 안 된다.
- `X-Request-Id`: BE가 생성한 요청 추적 ID. 서버 로그와 대조한다.

1초 이상 요청은 `request_timing` JSON 로그를 남긴다. `PERF_TIMING=true`면 빠른 요청도 남긴다. 라우트는 등록된 템플릿만 기록하며 사용자 ID·원본 URL은 남기지 않는다. 요청당 fetch 상세 기록은 최대 100건이다. fetch가 아닌 SDK 내부 통신·DB 쿼리는 별도 세분화하지 않고 전체 BE 시간에 포함된다.

DID 공개 프록시는 `did_upstream_headers`와 느린 요청의 `did_proxy_timing` 로그를 남긴다. 서버 이름과 상태만 남기며 QR·VC·DID 값은 남기지 않는다.

체인 거래 불러오기는 `operation_timing` 로그의 `sync.total`, `sync.scan`, `sync.persist`로 전체 작업·스캔·체인별 저장 단계를 구분한다. 스트리밍 스캔과 저장은 겹칠 수 있다. `sync.total`은 실제 작업 시작 이후이므로 큐 대기 시간까지 포함하는 수치는 아니다.

## 브라우저 실측

```sh
pnpm exec playwright install chromium --only-shell
PERF_OUTPUT=/tmp/verawallet-performance.json node scripts/performance-smoke.mjs
```

배포 사이트의 로그인·앱 설치 안내·공개 검증 화면을 데스크톱과 Pixel 7 에뮬레이션으로 연다. CX 인증창은 열고 취소만 한다. 계정 생성, 인증 제출, 서명, VC 발급은 하지 않는다. URL·응답 본문을 저장하지 않는 JSON 결과를 만든다. `PERF_ORIGIN`으로 테스트 서버를 선택할 수 있다.

한국 맥미니의 측정은 일본 이동통신망이나 실폰 성능을 대표하지 않는다. 로그인 이후 화면과 PIN·지갑 승인까지의 전체 동작은 실제 사용자 세션으로 추가 확인해야 한다. CX iframe 내부 리소스는 상위 창 PerformanceObserver에서 빠질 수 있으므로 자동화 도구의 네트워크 기록을 함께 본다. DID/CX 사업자 내부 처리·DB 상세 시간은 해당 서버의 계측 없이는 알 수 없다.
