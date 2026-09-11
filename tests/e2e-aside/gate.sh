#!/usr/bin/env bash
# aside CLI 기반 E2E의 시작 게이트.
# 원칙: aside CLI가 없으면 아무것도 시작하지 않는다(exit 2). 앱·BE가 없어도 시작하지 않는다(exit 3).
# 통과 시 stdout 마지막 줄에 GATE_OK JSON을 찍는다. run.sh와 사람이 같은 스크립트를 쓴다.
set -u
BASE_URL="${E2E_BASE_URL:-http://localhost:3100}"
BE_URL="${E2E_BE_URL:-http://localhost:3200}"
fail() { echo "GATE_FAIL code=$1 reason=$2" >&2; exit "$1"; }

# 1) aside CLI 존재 — 없으면 여기서 끝. 설치 안내만 남긴다.
if ! command -v aside >/dev/null 2>&1; then
  fail 2 "aside CLI가 PATH에 없습니다. Aside Browser를 설치하고 ~/.local/bin/aside가 잡히는지 확인하세요."
fi
ASIDE_BIN="$(command -v aside)"
ASIDE_VER="$(aside --version 2>/dev/null | head -1 || true)"
[ -n "$ASIDE_VER" ] || fail 2 "aside --version 응답이 없습니다: $ASIDE_BIN"

# 2) repl이 실제 브라우저에 붙는가(브라우저 앱이 꺼져 있으면 여기서 걸린다).
PROBE="$(aside repl "await (async () => { try { await openTab('about:blank'); console.log('ASIDE_REPL_OK'); } catch (e) { console.log('ASIDE_REPL_ERR ' + String(e)); } })();" < /dev/null 2>&1 || true)"
echo "$PROBE" | grep -q 'ASIDE_REPL_OK' || fail 2 "aside repl이 브라우저에 붙지 못했습니다. Aside Browser 앱이 실행 중인지 확인하세요. 출력: $(echo "$PROBE" | tail -3 | tr '\n' ' ')"

# 3) 대상 앱(dev 서버)과 BE.
APP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$BASE_URL/")"; [ -n "$APP_CODE" ] || APP_CODE=000
case "$APP_CODE" in 200|307|308) ;; *) fail 3 "앱이 응답하지 않습니다: $BASE_URL (HTTP $APP_CODE). pnpm dev 를 먼저 띄우세요." ;; esac
BE_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BE_URL/")"; [ -n "$BE_CODE" ] || BE_CODE=000
MODE="on"
if [ "$BE_CODE" = "000" ]; then
  # BE가 없으면 FE mock(OFF) 모드로 간주한다. .env.local이 ON이면 세션 라우트가 실패하므로 경고만 남긴다.
  MODE="off-or-unreachable"
fi

printf 'GATE_OK {"aside":"%s","version":"%s","app":"%s","appHttp":"%s","be":"%s","beHttp":"%s","mode":"%s"}\n' \
  "$ASIDE_BIN" "$ASIDE_VER" "$BASE_URL" "$APP_CODE" "$BE_URL" "$BE_CODE" "$MODE"
