#!/usr/bin/env bash
# aside CLI E2E 러너. 사용: tests/e2e-aside/run.sh [spec-glob-or-name ...]
#   예) tests/e2e-aside/run.sh            → specs/*.js 전부
#       tests/e2e-aside/run.sh 20 30      → 이름에 20 또는 30이 들어간 스펙만
# 환경: E2E_BASE_URL(기본 http://localhost:3100), E2E_MUTATE=1 이면 상태를 바꾸는 케이스(지갑 등록 등)도 실행.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$HERE/reports/$STAMP"

# 게이트를 통과하지 못하면 시작하지 않는다 — 이것이 이 러너의 첫 번째 규칙이다.
if ! GATE="$("$HERE/gate.sh")"; then
  echo "E2E를 시작하지 않습니다(게이트 실패). 위 GATE_FAIL 사유를 해결한 뒤 다시 실행하세요." >&2
  exit 2
fi
echo "$GATE"
mkdir -p "$OUT"
echo "$GATE" > "$OUT/gate.txt"

specs=()
if [ "$#" -eq 0 ]; then
  for f in "$HERE"/specs/*.js; do specs+=("$f"); done
else
  for pat in "$@"; do for f in "$HERE"/specs/*"$pat"*.js; do [ -e "$f" ] && specs+=("$f"); done; done
fi
[ "${#specs[@]}" -gt 0 ] || { echo "실행할 스펙이 없습니다." >&2; exit 1; }

TOTAL_PASS=0; TOTAL_FAIL=0; TOTAL_SKIP=0; FAILED_SPECS=()
for spec in "${specs[@]}"; do
  name="$(basename "$spec" .js)"
  bundle="$OUT/$name.bundle.js"
  {
    printf 'globalThis.E2E_BASE_URL = %s;\nglobalThis.E2E_MUTATE = %s;\n' "\"${E2E_BASE_URL:-http://localhost:3100}\"" "${E2E_MUTATE:-0}"
    cat "$HERE/lib/harness.js" "$HERE/lib/header.js" "$spec" "$HERE/lib/footer.js"
  } > "$bundle"
  echo "=== $name"
  # stdin을 /dev/null로: 코드가 비면 대화형 REPL로 빠져 멈추는 일을 막는다.
  aside repl "$(cat "$bundle")" < /dev/null > "$OUT/$name.log" 2>&1
  # 스크린샷 복원(B64START name … B64END).
  awk -v out="$OUT" -v spec="$name" '
    /^B64START / { name=$2; file=out "/" spec "." name ".b64"; collecting=1; next }
    /^B64END/ { collecting=0; next }
    collecting { print > file }
  ' "$OUT/$name.log"
  for b in "$OUT/$name".*.b64; do [ -e "$b" ] && base64 -D -i "$b" -o "${b%.b64}.jpg" 2>/dev/null && rm -f "$b"; done
  grep -E '^(SECTION|PASS|FAIL|SKIP|FATAL|SUMMARY)' "$OUT/$name.log" | grep -v '^B64' || true
  if grep -q 'REPL output truncated' "$OUT/$name.log"; then echo "!! $name: REPL 출력이 잘렸습니다(처리되지 않은 예외)."; FAILED_SPECS+=("$name"); fi
  s="$(grep '^SUMMARY' "$OUT/$name.log" | tail -1)"
  p="$(echo "$s" | sed -n 's/.*pass=\([0-9]*\).*/\1/p')"; f="$(echo "$s" | sed -n 's/.*fail=\([0-9]*\).*/\1/p')"; k="$(echo "$s" | sed -n 's/.*skip=\([0-9]*\).*/\1/p')"
  TOTAL_PASS=$((TOTAL_PASS + ${p:-0})); TOTAL_FAIL=$((TOTAL_FAIL + ${f:-0})); TOTAL_SKIP=$((TOTAL_SKIP + ${k:-0}))
  if [ -z "$s" ]; then echo "!! $name: SUMMARY 없음(스크립트가 끝까지 돌지 못함)"; FAILED_SPECS+=("$name"); elif [ "${f:-0}" -gt 0 ]; then FAILED_SPECS+=("$name"); fi
  grep '^RESULTS_JSON' "$OUT/$name.log" | sed 's/^RESULTS_JSON //' > "$OUT/$name.results.json" || true
done

echo
echo "TOTAL pass=$TOTAL_PASS fail=$TOTAL_FAIL skip=$TOTAL_SKIP  report=$OUT"
if [ "${#FAILED_SPECS[@]}" -gt 0 ]; then echo "FAILED: ${FAILED_SPECS[*]}"; exit 1; fi
exit 0
