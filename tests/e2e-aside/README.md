# aside CLI 전사 E2E (TDD)

Aside Browser의 `aside repl`(Playwright 유사 API, 사용자 브라우저 세션 공유)로 **모든 화면**을 실제 브라우저에서 검증한다.
Playwright 스위트(`tests/e2e`)가 "격리된 BE를 띄워 계약을 검증"하는 것과 달리, 이 스위트는 **지금 떠 있는 dev 앱 + 로그인된 실제 세션**을 그대로 두드린다. 사람이 QA하듯 본다.

## 0. 시작 게이트 — aside가 없으면 시작하지 않는다

```
tests/e2e-aside/gate.sh          # 단독 실행 가능
tests/e2e-aside/run.sh [pat...]  # 내부에서 gate.sh 를 먼저 부른다
```

| 순서 | 검사 | 실패 시 |
|---|---|---|
| 1 | `command -v aside`, `aside --version` | exit 2, "aside CLI가 PATH에 없습니다" |
| 2 | `aside repl`로 탭을 실제로 연다 | exit 2, "Aside Browser 앱이 실행 중인지" |
| 3 | 앱 `E2E_BASE_URL/`(기본 3100)이 200/307/308 | exit 3, "pnpm dev 를 먼저" |
| 4 | BE `E2E_BE_URL/`(기본 3200) 응답 여부 → 모드 표기 | 경고만(OFF/mock 모드일 수 있음) |

게이트를 통과하면 `GATE_OK {...json}` 한 줄이 찍히고 그때만 스펙이 실행된다.

## 1. 실행 모델

- `run.sh`는 스펙마다 `lib/harness.js + lib/header.js + specs/NN-*.js + lib/footer.js`를 이어 붙여 `aside repl "$(cat bundle)" < /dev/null`로 보낸다.
- 스펙은 `PASS|FAIL|SKIP <id> — detail` 줄을 찍고, footer가 `SUMMARY`·`RESULTS_JSON`을 찍는다. 러너가 이를 모아 `reports/<timestamp>/`에 로그·JSON·스크린샷(jpg)을 남긴다.
- 실패한 스펙이 하나라도 있으면 exit 1. `REPL output truncated`(처리되지 않은 예외)도 실패로 친다.
- `E2E_MUTATE=1`이면 서버 상태를 바꾸는 케이스(지갑 추가 등록 등)도 돈다. 기본은 읽기 전용 + 세션 로그아웃/재로그인만.

### aside repl 함정과 하네스의 대응(`lib/harness.js`)

| 함정 | 대응 |
|---|---|
| 최상위 프로미스를 기다리지 않음 | header/footer가 `await (async () => {...})()`로 감쌈 |
| 예외가 새면 stdout 전체가 잘림 | `run(name, fn)` 케이스 래퍼 + footer catch |
| `p.url()`이 클라이언트 라우팅 뒤 갱신 안 됨 | `path(p)` = `location.pathname+search` |
| 접근성 트리에서 h3 안 배지 텍스트가 빠짐 | `text(p)` = `document.body.innerText`로 단언 |
| `getByRole({name:한글})` 실패 | CSS locator만 사용(`button:has-text()`, `[aria-label^=]`, `#id`) |
| 로컬 파일 저장 불가 | `shot()`이 base64로 흘리고 run.sh가 `base64 -D`로 복원 |
| about:blank에서 앱 fetch가 교차출처 | `newPage()`가 `/api/auth/session`(동일 출처)에서 시작 |
| 코드가 비면 대화형 REPL로 빠져 멈춤 | `< /dev/null` |

## 2. TDD 절차

1. **Red**: 화면 계약(컴포넌트 코드의 문구·selector·상태)에서 케이스를 먼저 쓴다. 아직 없는 동작도 케이스로 적는다 → 실행해 빨간색을 확인한다.
2. **판정**: 빨간 케이스가 (a) 앱 결함인지 (b) 테스트의 selector/타이밍 오류인지 로그·스크린샷으로 가른다. (b)는 테스트를 고치고, (a)는 이슈로 기록한다.
3. **Green**: (a)는 최소 수정으로 앱을 고치고 재실행. 단위 테스트(`pnpm test`)도 같이 돌린다.
4. **Refactor**: 반복되는 대기·selector는 harness로 올린다. 스펙에는 시나리오만 남긴다.
5. 커밋 전 `run.sh` 전체 green + `pnpm test` green.

## 3. 화면별 케이스 매트릭스

세션 상태는 실행 시점의 실제 상태다(같은 DID → 같은 사용자, BE mock identity). 스펙은 세션을 읽어 **상태에 맞는 분기**를 검증하고, 전제가 안 맞는 케이스는 `SKIP`으로 사유를 남긴다.

| 스펙 | 화면 | 핵심 케이스 |
|---|---|---|
| 00 | 하네스 | 세션 JSON, `/` 리다이렉트 |
| 10 | 로그인 `/login` | 인증됨→/dashboard 리다이렉트, 로그아웃→로그인 화면 문구·온보딩 단계 표시, 국가 선택·모바일신분증 인증→세션 didVerified, 재로그인 후 지갑 바인딩 유지 |
| 20 | 요약 `/dashboard` | 헤더 "요약"·요약 카드·그래프·신뢰도·기간 선택·금액 가리기, 목록·필터가 없음(문만 남음), 최근 거래 1~3건·"전체 N건 보기"→/transactions, 확인 필요 카드→`/transactions?tab=review`, 최근 행 클릭 상세, 설정 톱니, 빈 상태(DID-only) CTA |
| 25 | 거래 `/transactions` | 헤더·건수·검색·필터 칩 한 줄·탭, 첫 행이 첫 화면 안(top<500), 헤더 sticky, 필터 시트(항목별 건수 = 선택 후 행 수)·해제, 확인 필요 탭(배지 수 = 행 수), `?tab=review` 딥링크, 검색(심볼·없는 검색어·원복), 행 클릭 상세, 스팸 보기(보기 전용·되돌리기 없음) |
| 30 | 지갑 `/wallets`, `/wallets/[addr]` | 총액·소스 탭·그룹 카드·주소 표시·미검증 배지, 계정 열기→상세, 포트폴리오 행(로고·금액·펼침), 체인 합산 행 펼침 시 체인별 내역, 잘못된 주소→404 |
| 40 | 지갑 추가 `/connect-wallet` | add 모드 헤더·닫기→/wallets, `?method=address` 즉시 주소 단계, 주소 검증(형식 오류·이미 등록·유효), 다음→확인 시트, (MUTATE) 등록→`/wallets?importing=1` 모달·백그라운드 칩·완료 토스트 |
| 50 | 리포트의 계산(옛 세금 탭) `/tax`→`/export` | `/tax`는 `/export`로 리다이렉트, 시행 가정이 기본 켜짐·끄기/다시 켜기(금액 원복), 계산은 미구독도 전부 보임(`data-locked=amount` 0개), 근거 섹션 이사, 나라 비교는 맨 아래 접힘·"비교 중" 표시·비교 중 내려받기 차단·"거주국으로", 데모 시나리오 중 내려받기 차단, 껍데기 넘침 0 |
| 60 | 플랜 `/plan` | 탭 노출(곁길), 플랜 카드·과세연도, 다열 그리드 없음(448px 폭 규칙) |
| 65 | 설정 `/settings` | 요약 톱니로 진입, 플랜→/plan·스팸 거래 보기→/transactions·로그아웃, 세금 계산 항목 없음(1차 범위 밖), 금액 가리기 스위치가 요약과 값 공유, 로그아웃→/login·재로그인 후 지갑 바인딩 유지 |
| 70 | 리포트 `/export` | 헤더 "리포트"·귀속연도 칩·전환/복귀, 두 가지 내려받기, **잠기는 것은 내려받기뿐**(미구독: 버튼 2개 disabled + "계산은 무료예요" + 플랜 줄 / 구독: 상태 카드·게이지·과세연도별 결제), 하단 탭 "리포트" 활성, DID-only는 데모 계산 + 내려받기 차단 |
| 80 | 내비·404·공통 | 4탭(요약·거래·지갑·리포트 — 세금 탭은 리포트로 합쳐짐) 한 줄·링크 이동·aria-current, 거래 탭 확인 필요 **점** 배지(숫자 없음 — 요약 API는 다리 단위, 거래 탭은 행 단위라 숫자가 갈린다), /plan·/settings 곁길 탭 노출, 온보딩 화면에서 탭 숨김, 404 뷰("거래로 이동"→/transactions), 면책 푸터 sticky, 모든 화면 가로 오버플로 없음 |

## 4. 리포트

`reports/<timestamp>/gate.txt`, `<spec>.log`, `<spec>.results.json`, `<spec>.<shot>.jpg`. `reports/`는 git에 올리지 않는다.
