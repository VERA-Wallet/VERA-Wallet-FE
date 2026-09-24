// 71: 내려받기의 묶음 등록 게이트 — 미등록·진행 중·성공·실패·재시도를 브라우저에서 고정한다.
// 70은 /export의 읽기 전용 계약을 맡는다. 여기서는 클릭이 서버 상태(mock 계산 근거 저장소)를 바꾸므로 스펙을 뗀다.
//
// 등록 단위는 **리포트 한 벌**이다: 계산 근거 + CSV + XLSX의 해시를 한 루트로 묶어 한 번 올리고,
// 확정된 뒤에야 누른 파일이 저장된다. 그래서 상태 줄은 행이 아니라 **카드 상단**에 하나뿐이고,
// 진행 중에는 두 행이 함께 잠기며, 루트가 이미 확정된 뒤에는 어느 행을 눌러도 시트 없이 곧바로 저장된다.
//
// OFF(mock) 모드 전용이다. 제어 라우트 `POST /api/mock/tax-evidence-failure`가 ON 모드·production에서 404이고,
// 그 404가 "여기서 볼 게 없다"는 판별자다(app/api/mock/tax-evidence-failure/route.ts:18).
// 제어 라우트는 세션 가드가 있으므로 반드시 페이지 컨텍스트의 same-origin fetch(json())로 부른다 — curl은 쿠키가 없다.
const MUTATE = globalThis.E2E_MUTATE === 1 || globalThis.E2E_MUTATE === '1';
// 두 행은 버튼 **자신**이 종류를 말한다(downloads.tsx: `data-anchor-kind`가 <button>에 붙는다).
const CSV = '[data-anchor-kind=csv]';
const XLSX = '[data-anchor-kind=xlsx]';
const CARD = '[data-surface=download-card]';
const SHEET = '[data-surface=anchor-sheet]';
const CONFIRM = '[data-surface=anchor-sheet-confirm]';
// 「다시 시도」는 둘이다 — 카드 상단 실패 줄 안과 시트 안. 어느 것을 누르는지 스펙이 밝힌다.
const CARD_RETRY = '[data-surface=anchor-failed] [data-surface=anchor-retry]';
const SHEET_RETRY = SHEET + ' [data-surface=anchor-retry]';
// 상태 줄은 카드에 **하나**다. 시트(anchor-sheet)·재시도 버튼은 이 목록에 들어가지 않는다.
// 뒤의 넷은 복원 경로(돌아온 카드)의 줄이다 — 확인 중·등록됨·계산 바뀜·확인 실패.
const LINES = [
  'anchor-idle', 'anchor-progress', 'anchor-done', 'anchor-failed',
  'anchor-checking', 'anchor-restored', 'anchor-stale', 'anchor-unknown',
].map((name) => `[data-surface=${name}]`).join(',');
// 40이 쓰는 것과 같은 체크섬 유효 주소. 지갑이 없으면 내려받기가 차단돼 게이트를 볼 수 없다.
const WATCH = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

const p = await newPage();
const s = await ensureLogin(p);

const control = (body) => json(p, '/api/mock/tax-evidence-failure', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
// 내려받기 가로채기. 진짜 파일이 디스크로 나가지 않게 하고, 동시에 "파일이 나갔는가"를 셀 수 있게 한다.
// download 속성이 있는 앵커만 삼킨다(보통 링크는 그대로 둔다). go() 뒤마다 다시 심는다 — 페이지가 새로 뜨면 사라진다.
const intercept = () => p.evaluate(() => {
  window.__dl = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl.push(this.download); return; } return orig.call(this); };
});
const dl = () => p.evaluate(() => (window.__dl || []).slice());
const surface = (sel) => p.evaluate((sel) => { const el = document.querySelector(sel); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const disabled = (sel) => p.evaluate((sel) => { const b = document.querySelector(sel); return b ? b.disabled : null; }, sel);
// 콤마 selector는 locator로 세지 않는다(구현마다 갈린다). 상태 줄 개수는 DOM에서 직접 센다.
const lineCount = () => p.evaluate((sel) => document.querySelectorAll(sel).length, LINES);
// 카드에 처음 닿는 순간의 복원 조회를 발화시킨다. React의 onPointerEnter는 최상위 pointerover로 붙는다.
const touchCard = () => p.evaluate((sel) => {
  const el = document.querySelector(sel); if (el) el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
}, CARD);
const openExport = async () => {
  await go(p, '/export', 3500);
  const arrived = await until(p, async () => ((await count(p, CSV)) === 1 ? true : null), 30000);
  await intercept();
  await touchCard();
  await wait(1500); // 복원 조회가 끝날 여유. 끝나야 "게이트 꺼짐"·"최근 등록" 판정이 정확하다.
  return !!arrived;
};
// shot()은 뷰포트만 찍는다. 카드는 첫 화면 아래에 있으므로 클릭(scrollIntoView)을 거치지 않는 캡처는
// 직접 끌어와야 상태 줄이 담긴다.
const scrollToCard = async () => {
  await p.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.scrollIntoView({ block: 'center' }); }, CARD);
  await wait(300);
};
// 시트를 닫는다. 성공·실패 시트는 열린 채 남으므로(사용자가 닫는다) 카드 상단 줄을 찍기 전에 치운다.
const closeSheet = async () => {
  await domClick(p, SHEET + ' button', /^(닫기|백그라운드에서 계속)$/);
  return until(p, async () => (((await count(p, SHEET)) === 0) ? true : null), 5000, 200);
};

async function main() {
  if (!(s && s.didVerified)) { skip('71 전체', '인증 세션 없음'); return false; }

  const probe = await control({});
  if (probe.status === 404) { skip('71 전체', 'ON 모드(mock 제어 라우트 없음)'); return false; }
  if (probe.status === 401) { skip('71 전체', '세션 없음'); return false; }
  if (probe.status !== 200) { skip('71 전체', '제어 라우트 응답 ' + probe.status); return false; }

  // 처음부터 비운 저장소에서 시작해야 "아직 등록되지 않았어요"가 앞선 실행의 잔재가 아니다.
  if (MUTATE) await control({ failing: false, reset: true });

  // 전제 1: 지갑. 없으면 blockedReason이 내려받기를 막아 게이트가 시작조차 하지 않는다.
  let sess = s;
  if (!sess.walletAddress) {
    if (!MUTATE) { skip('71 전체', '지갑 미연결(E2E_MUTATE=1이면 보기 전용 주소를 등록해 이어간다)'); return false; }
    const r = await json(p, '/api/auth/wallet/watch', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: WATCH }),
    });
    if (r.status !== 201) { skip('71 전체', '보기 전용 지갑 등록 실패 ' + r.status); return false; }
    sess = await session(p);
    console.log('SETUP 보기 전용 지갑 등록 ' + (sess && sess.walletAddress));
  }

  if (!(await openExport())) { skip('71 전체', '/export 에 내려받기 버튼이 뜨지 않음'); return false; }

  // 전제 2: 차단 사유(데모 시나리오·비교 중·지갑 미연결). 게이트보다 앞선 규칙이라 게이트가 돌지 않는다.
  if ((await count(p, '[data-surface=download-blocked]')) === 1) {
    skip('71 전체', '내려받기 차단: ' + String(await surface('[data-surface=download-blocked]')).slice(0, 60));
    return false;
  }

  // 전제 3: 플랜 잠금. 플랜은 브라우저 로컬 mock 결제 상태다(lib/plan/use-plan.ts) — 서버 상태가 아니다.
  // 게이트를 보려면 버튼이 눌려야 하므로 MUTATE에서만 심고, 끝에 원래 값으로 되돌린다.
  let priorPlan = null;
  let planSeeded = false;
  if ((await disabled(CSV)) === true) {
    if (!MUTATE) { skip('71 전체', '내려받기 잠김(플랜 없음 — E2E_MUTATE=1이면 로컬 mock 플랜을 심어 이어간다)'); return false; }
    priorPlan = await p.evaluate(() => {
      const before = localStorage.getItem('vw_plan');
      localStorage.setItem('vw_plan', JSON.stringify({ tier: 'pro', taxYear: new Date().getFullYear(), activatedAt: new Date().toISOString() }));
      return before;
    });
    planSeeded = true;
    console.log('SETUP 로컬 mock 플랜(pro) 주입 — 끝에 되돌린다');
    await openExport();
    if ((await disabled(CSV)) === true) {
      skip('71 전체', '플랜을 심어도 내려받기가 잠겨 있다(한도 초과일 수 있다)');
      return { planSeeded, priorPlan };
    }
  }

  // 전제 4: 게이트 스위치. 꺼져 있으면(REPORT_ANCHOR_GATE=off) 상단 줄도 시트도 그려지지 않는다 —
  // 행은 그대로 있고 클릭은 곧바로 파일을 내보낸다. 앱이 멀쩡한데 빨간 리포트가 나오지 않게 여기서 가른다.
  if ((await lineCount()) === 0) {
    skip('71 전체', '등록 게이트 꺼짐(REPORT_ANCHOR_GATE=off) — 상단 상태 줄이 없다');
    return { planSeeded, priorPlan };
  }

  // 전제 5: 등록할 계산. 계산이 없는 기간은 게이트 자체가 걸리지 않는다(시트 없이 곧바로 저장된다).
  const firstLine = await surface('[data-surface=anchor-idle]');
  if (firstLine && /등록할 계산 근거가 없어요/.test(firstLine)) {
    skip('71 전체', '등록할 계산 근거가 없는 기간이라 게이트가 걸리지 않는다');
    return { planSeeded, priorPlan };
  }

  section('71 묶음 등록 게이트');

  await run('미등록 — 누르기 전에는 상단 줄이 「아직 등록되지 않았어요」 하나다', async () => {
    ok('두 가지 내려받기 버튼', (await count(p, 'button:has-text("직접 신고용 내려받기")')) === 1 && (await count(p, 'button:has-text("세무사 전달용 내려받기")')) === 1);
    const idle = await surface('[data-surface=anchor-idle]');
    ok('상태 줄은 카드에 하나(anchor-idle)', (await lineCount()) === 1 && idle !== null, idle);
    ok('"아직 체인에 등록되지 않았어요"', !!idle && /아직 체인에 등록되지 않았어요/.test(idle), idle);
    if (MUTATE) {
      ok('저장소를 비웠으므로 보조 줄은 "처음 내려받을 때 계산 근거와 파일을 한 번에 등록해요."',
        !!idle && /처음 내려받을 때 계산 근거와 파일을 한 번에 등록해요/.test(idle), idle);
    }
    ok('진행·성공·실패 줄 0개', (await count(p, '[data-surface=anchor-progress]')) === 0 && (await count(p, '[data-surface=anchor-done]')) === 0 && (await count(p, '[data-surface=anchor-failed]')) === 0);
    ok('시트는 닫혀 있다(호버·포커스로 열리지 않는다)', (await count(p, SHEET)) === 0);
    ok('각주 — 무엇을 올리고 무엇을 안 올리는지', await domHas(p, CARD, /계산 근거 \+ CSV \+ XLSX의 해시를 하나의 루트로 묶어 체인에 한 번 등록해요\. 금액·지갑 주소는 올라가지 않아요\./));
    await scrollToCard();
    await shot(p, 'anchor_idle');
  });

  if (!MUTATE) {
    skip('묶음 등록 네 상태', 'E2E_MUTATE=1 이 아니라 상태를 바꾸지 않는다');
    return { planSeeded, priorPlan };
  }

  let csvDone = null;

  await run('CSV 탭 → 확인 시트 → 내려받기 → 진행 중 → 성공 한 줄', async () => {
    ok('CSV 내려받기 클릭', await domClick(p, CSV, /직접 신고용 내려받기/));

    // 탭 = 등록이 아니다. 조회(document(root))가 끝나면 확인 시트가 열리고 거기서 멈춘다.
    const sheet = await until(p, async () => (await surface(SHEET)) || null, 30000, 300);
    ok('바텀시트(data-surface=anchor-sheet)가 열린다', !!sheet, sheet);
    ok('제목 "신고 자료를 내려받을 수 있어요"', !!sheet && /신고 자료를 내려받을 수 있어요/.test(sheet), sheet);
    ok('4단계 목록(파일 만들기 · 계산 근거와 묶기 · 체인에 등록 · 저장)',
      !!sheet && /파일 만들기/.test(sheet) && /계산 근거와 묶기/.test(sheet) && /체인에 등록/.test(sheet) && /저장/.test(sheet), sheet);
    ok('확인 버튼(data-surface=anchor-sheet-confirm) 1개 · 문구 "내려받기"',
      (await count(p, CONFIRM)) === 1 && (await surface(CONFIRM)) === '내려받기', await surface(CONFIRM));
    ok('아직 등록도 저장도 하지 않았다(__dl=0)', (await dl()).length === 0);

    ok('시트의 "내려받기" 클릭', await domClick(p, CONFIRM));

    // 진행 줄은 registering→waiting 동안만 보인다(mock 확정 2.5초 + 폴링 1.5초 → 최소 ~4초 창).
    // 창을 놓치지 않도록 짧은 간격으로 돌면서 그 순간의 카드·시트·버튼 상태를 함께 떠 둔다.
    let seen = null;
    await until(p, async () => {
      const v = await p.evaluate((sels) => {
        const line = document.querySelector('[data-surface=anchor-progress]');
        if (!line) return null;
        const sheet = document.querySelector('[data-surface=anchor-sheet]');
        const buttons = sheet ? [...sheet.querySelectorAll('button')] : [];
        const csv = document.querySelector(sels[0]);
        const xlsx = document.querySelector(sels[1]);
        return {
          text: line.textContent.replace(/\s+/g, ' ').trim(),
          sheet: sheet ? sheet.textContent.replace(/\s+/g, ' ').trim() : null,
          last: buttons.length ? buttons[buttons.length - 1].textContent.trim() : null,
          csv: csv ? csv.disabled : null,
          xlsx: xlsx ? xlsx.disabled : null,
          files: (window.__dl || []).length,
        };
      }, [CSV, XLSX]);
      if (v) { seen = v; return true; }
      return null;
    }, 20000, 120);

    if (seen === null) { ok('진행 중 줄(data-surface=anchor-progress)', false, '__dl=' + (await dl()).length + ' lines=' + (await lineCount())); return; }
    await shot(p, 'anchor_progress');
    ok('진행 중 줄 "체인에 등록하고 있어요 / 등록이 끝나면 파일이 저장돼요."',
      /체인에 등록하고 있어요/.test(seen.text) && /등록이 끝나면 파일이 저장돼요/.test(seen.text), seen.text);
    // 등록이 하나이므로 진행 중에는 **두 행이 함께** 잠긴다(파일별 등록과 달라지는 지점).
    ok('진행 중에는 두 행이 함께 잠긴다', seen.csv === true && seen.xlsx === true, 'csv=' + seen.csv + ' xlsx=' + seen.xlsx);
    ok('시트도 "체인에 등록하고 있어요" + 보조 버튼 "백그라운드에서 계속"',
      !!seen.sheet && /체인에 등록하고 있어요/.test(seen.sheet) && seen.last === '백그라운드에서 계속', seen.last);
    ok('아직 파일은 나가지 않았다', seen.files === 0);

    csvDone = await until(p, async () => (await surface('[data-surface=anchor-done]')) || null, 90000, 400);
    ok('성공 한 줄(data-surface=anchor-done)', !!csvDone, csvDone);
    ok('"체인에 등록됐어요" + 루트·tx 해시 앞 10자',
      !!csvDone && /체인에 등록됐어요/.test(csvDone) && /루트 0x[0-9a-f]{8}/.test(csvDone) && /tx 0x[0-9a-f]{8}/.test(csvDone), csvDone);
    ok('진행 줄은 사라지고 상태 줄은 여전히 하나', (await count(p, '[data-surface=anchor-progress]')) === 0 && (await lineCount()) === 1);
    const names = await dl();
    ok('그제서야 파일이 정확히 한 번 나간다(파일명 계약 유지)', names.length === 1 && /^verawallet-신고근거-.+\.csv$/.test(names[0]), JSON.stringify(names));
    const doneSheet = await surface(SHEET);
    ok('시트는 루트·거래 해시·등록 시각을 보인다', !!doneSheet && /체인에 등록됐어요/.test(doneSheet) && /루트/.test(doneSheet) && /등록 시각/.test(doneSheet), doneSheet);
    ok('시트를 닫는다', !!(await closeSheet()));
    await shot(p, 'anchor_done');
  });

  await run('XLSX 탭 — 루트가 이미 확정됐으므로 시트 없이 곧바로 저장(트랜잭션 0회)', async () => {
    if (!csvDone) { skip('XLSX 즉시 저장', '앞 케이스에서 성공 줄을 얻지 못했다'); return; }
    ok('XLSX 내려받기 클릭', await domClick(p, XLSX, /세무사 전달용 내려받기/));
    const twice = await until(p, async () => (((await dl()).length === 2) ? true : null), 20000, 200);
    const names = await dl();
    ok('파일이 곧바로 한 번 더 나간다(.xlsx)', !!twice && /^verawallet-신고근거-.+\.xlsx$/.test(names[1] || ''), JSON.stringify(names));
    ok('시트는 열리지 않는다', (await count(p, SHEET)) === 0);
    const after = await surface('[data-surface=anchor-done]');
    ok('성공 줄이 글자 그대로 같다(같은 루트·같은 tx·같은 시각 = 새 트랜잭션 없음)', after === csvDone, after);
  });

  await run('실패 → 다시 시도 → 성공', async () => {
    const c = await control({ failing: true, reset: true });
    ok('실패 스위치 on + 저장소 초기화', c.status === 200 && c.body && c.body.data && c.body.data.failing === true && c.body.data.records === 0, JSON.stringify(c.body));
    await openExport();
    ok('XLSX 내려받기 클릭', await domClick(p, XLSX, /세무사 전달용 내려받기/));
    ok('확인 시트가 열린다', !!(await until(p, async () => ((await count(p, CONFIRM)) === 1 ? true : null), 30000, 300)));
    ok('시트의 "내려받기" 클릭', await domClick(p, CONFIRM));

    // 유예 창(5초) 때문에 첫 failed 폴링은 아직 실패가 아니다 — 확정(2.5초) 뒤 두 번째 폴링에서 끝난다.
    const failed = await until(p, async () => (await surface('[data-surface=anchor-failed]')) || null, 90000, 300);
    ok('실패 줄(data-surface=anchor-failed) "등록하지 못했어요"', !!failed && /등록하지 못했어요/.test(failed), failed);
    ok('고정 사유 "체인에 등록하지 못했어요. 다시 시도하면 새로 등록해요."',
      !!failed && /체인에 등록하지 못했어요\. 다시 시도하면 새로 등록해요\./.test(failed), failed);
    ok('실패 줄 안에 "다시 시도" 버튼 1개', (await count(p, CARD_RETRY)) === 1);
    ok('실패했으므로 파일은 나가지 않았다(__dl=0)', (await dl()).length === 0, '사유: ' + failed);
    ok('성공 줄은 없다', (await count(p, '[data-surface=anchor-done]')) === 0);
    const sheet = await surface(SHEET);
    ok('시트도 같은 사유 + "다시 시도"', !!sheet && /체인에 등록하지 못했어요/.test(sheet) && (await count(p, SHEET_RETRY)) === 1, sheet);
    ok('시트를 닫는다', !!(await closeSheet()));
    await shot(p, 'anchor_failed');

    const c2 = await control({ failing: false });
    ok('실패 스위치 off', c2.status === 200 && c2.body && c2.body.data && c2.body.data.failing === false, JSON.stringify(c2.body));
    // 카드 줄의 「다시 시도」다. 조회를 건너뛰고 곧바로 재제출하므로 확인 시트는 다시 열리지 않는다.
    ok('카드의 "다시 시도" 클릭', await domClick(p, CARD_RETRY));

    const done = await until(p, async () => (await surface('[data-surface=anchor-done]')) || null, 90000, 400);
    ok('재시도로 성공 한 줄에 도달', !!done && /체인에 등록됐어요/.test(done), done);
    ok('실패 줄·다시 시도 버튼은 사라진다', (await count(p, '[data-surface=anchor-failed]')) === 0 && (await count(p, '[data-surface=anchor-retry]')) === 0);
    ok('재시도는 확인 시트를 다시 묻지 않는다', (await count(p, SHEET)) === 0);
    const names = await dl();
    ok('그제서야 파일이 한 번 나간다(.xlsx)', names.length === 1 && /^verawallet-신고근거-.+\.xlsx$/.test(names[0]), JSON.stringify(names));
    await shot(p, 'anchor_retry_done');
  });

  await run('게이트 줄·시트가 껍데기를 넘지 않는다', async () => {
    const o = await shellOverflow(p);
    ok('넘침 0', o.count === 0, o.worst);
  });

  return { planSeeded, priorPlan };
}

const setup = await main();
// 정리: 실패 스위치를 끄고 저장소를 비운다. 심어 둔 로컬 mock 플랜도 원래 값으로 되돌린다.
// 읽기 전용 실행(MUTATE 아님)은 아무것도 바꾸지 않았으므로 되돌릴 것도 없다 — reset은 남의 기록까지 지운다.
if (setup && MUTATE) {
  const c = await control({ failing: false, reset: true });
  ok('정리 — 실패 스위치 off + 저장소 비움', c.status === 200 && c.body && c.body.data && c.body.data.failing === false && c.body.data.records === 0, JSON.stringify(c.body));
  if (setup.planSeeded) {
    await p.evaluate((before) => { if (before === null) localStorage.removeItem('vw_plan'); else localStorage.setItem('vw_plan', before); }, setup.priorPlan);
    console.log('CLEANUP 로컬 mock 플랜 복원');
  }
}
await closePage(p);
