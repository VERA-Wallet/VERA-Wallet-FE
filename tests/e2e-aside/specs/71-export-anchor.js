// 71: 리포트 내려받기의 등록 게이트 — 진행 중·성공·실패·재시도 네 상태를 브라우저에서 고정한다.
// 70은 /export의 읽기 전용 계약을 맡는다. 여기서는 클릭이 서버 상태(mock 앵커 저장소)를 바꾸므로 스펙을 뗀다.
//
// OFF(mock) 모드 전용이다. 제어 라우트 `POST /api/mock/report-anchor-failure`가 ON 모드·production에서 404이고,
// 그 404가 "여기서 볼 게 없다"는 판별자다(app/api/mock/report-anchor-failure/route.ts:16).
// 제어 라우트는 세션 가드가 있으므로 반드시 페이지 컨텍스트의 same-origin fetch(json())로 부른다 — curl은 쿠키가 없다.
const MUTATE = globalThis.E2E_MUTATE === 1 || globalThis.E2E_MUTATE === '1';
const CSV = '[data-anchor-kind=csv]';
const XLSX = '[data-anchor-kind=xlsx]';
// 40이 쓰는 것과 같은 체크섬 유효 주소. 지갑이 없으면 내려받기가 차단돼 게이트를 볼 수 없다.
const WATCH = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

const p = await newPage();
const s = await ensureLogin(p);

const control = (body) => json(p, '/api/mock/report-anchor-failure', {
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
// 카드에 처음 닿는 순간의 복원 조회를 발화시킨다. React의 onPointerEnter는 최상위 pointerover로 붙는다.
const touchCards = () => p.evaluate((sels) => {
  for (const sel of sels) { const el = document.querySelector(sel); if (el) el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); }
}, [CSV, XLSX]);
const openExport = async () => {
  await go(p, '/export', 3500);
  const arrived = await until(p, async () => ((await count(p, CSV + ' button')) >= 1 ? true : null), 30000);
  await intercept();
  await touchCards();
  await wait(1500); // 복원 조회가 끝날 여유. 끝나야 "게이트 꺼짐" 판정이 정확하다.
  return !!arrived;
};

async function main() {
  if (!(s && s.didVerified)) { skip('71 전체', '인증 세션 없음'); return false; }

  const probe = await control({});
  if (probe.status === 404) { skip('71 전체', 'ON 모드(mock 제어 라우트 없음)'); return false; }
  if (probe.status === 401) { skip('71 전체', '세션 없음'); return false; }
  if (probe.status !== 200) { skip('71 전체', '제어 라우트 응답 ' + probe.status); return false; }

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
  if ((await disabled(CSV + ' button')) === true) {
    if (!MUTATE) { skip('71 전체', '내려받기 잠김(플랜 없음 — E2E_MUTATE=1이면 로컬 mock 플랜을 심어 이어간다)'); return false; }
    priorPlan = await p.evaluate(() => {
      const before = localStorage.getItem('vw_plan');
      localStorage.setItem('vw_plan', JSON.stringify({ tier: 'pro', taxYear: new Date().getFullYear(), activatedAt: new Date().toISOString() }));
      return before;
    });
    planSeeded = true;
    console.log('SETUP 로컬 mock 플랜(pro) 주입 — 끝에 되돌린다');
    await openExport();
    if ((await disabled(CSV + ' button')) === true) {
      skip('71 전체', '플랜을 심어도 내려받기가 잠겨 있다(한도 초과일 수 있다)');
      return { planSeeded, priorPlan };
    }
  }

  section('71 등록 게이트');

  await run('초기 상태 — 누르기 전에는 게이트 줄이 없다', async () => {
    ok('두 가지 내려받기 버튼', (await count(p, 'button:has-text("직접 신고용 내려받기")')) === 1 && (await count(p, 'button:has-text("세무사 전달용 내려받기")')) === 1);
    ok('진행 중 줄 0개', (await count(p, '[data-surface=anchor-progress]')) === 0);
    ok('실패 줄 0개', (await count(p, '[data-surface=anchor-failed]')) === 0);
  });

  if (!MUTATE) {
    skip('등록 게이트 네 상태', 'E2E_MUTATE=1 이 아니라 상태를 바꾸지 않는다');
    return { planSeeded, priorPlan };
  }

  let gateOff = false;
  let csvDone = null;

  await run('진행 중 → 성공 한 줄', async () => {
    const c = await control({ failing: false, reset: true });
    ok('제어 라우트 초기화(failing=false·reset)', c.status === 200 && c.body && c.body.data && c.body.data.failing === false, JSON.stringify(c.body));
    await openExport();
    ok('CSV 내려받기 클릭', await domClick(p, CSV + ' button', /직접 신고용 내려받기/));

    // 진행 줄은 registering→waiting 동안만 보인다(mock 확정 1.2초 + 폴링 1.5초 → 최소 1.5초 창).
    // 창을 놓치지 않도록 짧은 간격으로 돌면서 그 순간의 문구·버튼 상태를 함께 떠 둔다.
    let seen = null;
    await until(p, async () => {
      const v = await p.evaluate((sel) => {
        const el = document.querySelector('[data-surface=anchor-progress]');
        if (!el) return null;
        const b = document.querySelector(sel + ' button');
        return { text: el.textContent.replace(/\s+/g, ' ').trim(), label: b ? b.textContent.trim() : null, disabled: b ? b.disabled : null };
      }, CSV);
      if (v) { seen = v; return true; }
      return null;
    }, 20000, 120);

    if (seen === null) {
      const names = await dl();
      const surfaces = await count(p, '[data-surface^=anchor-]');
      if (names.length >= 1 && surfaces === 0) {
        gateOff = true;
        skip('진행 중', '등록 게이트 꺼짐(REPORT_ANCHOR_GATE=off) — 클릭이 곧바로 파일을 내보냈다: ' + names[0]);
        return;
      }
      ok('진행 중 줄(data-surface=anchor-progress)', false, '__dl=' + names.length + ' anchor surfaces=' + surfaces);
      return;
    }
    await shot(p, 'anchor_progress');
    ok('진행 중 줄 "체인에 등록하는 중입니다. 등록이 끝나면 파일이 저장됩니다."', /체인에 등록하는 중입니다\. 등록이 끝나면 파일이 저장됩니다\./.test(seen.text), seen.text);
    ok('진행 중에는 버튼이 "체인에 등록하는 중…"으로 잠긴다', seen.disabled === true && seen.label === '체인에 등록하는 중…', seen.label + ' disabled=' + seen.disabled);
    ok('아직 파일은 나가지 않았다', (await dl()).length === 0);

    csvDone = await until(p, async () => (await surface(CSV + ' [data-surface=anchor-done]')) || null, 75000, 400);
    ok('성공 한 줄(data-surface=anchor-done)', !!csvDone, csvDone);
    ok('"체인에 등록됨" + 파일·tx 해시 앞 10자', !!csvDone && /체인에 등록됨/.test(csvDone) && (csvDone.match(/0x[0-9a-f]{8}/g) || []).length >= 2, csvDone);
    ok('진행 줄은 사라진다', (await count(p, '[data-surface=anchor-progress]')) === 0);
    const names = await dl();
    ok('그제서야 파일이 정확히 한 번 나간다(파일명 계약 유지)', names.length === 1 && /^verawallet-신고근거-.+\.csv$/.test(names[0]), JSON.stringify(names));
    await shot(p, 'anchor_done');
  });

  if (gateOff) {
    skip('71 나머지', '등록 게이트 꺼짐(REPORT_ANCHOR_GATE=off)');
    return { planSeeded, priorPlan };
  }

  await run('멱등 재클릭 — 트랜잭션을 새로 만들지 않는다', async () => {
    if (!csvDone) { skip('멱등 재클릭', '앞 케이스에서 성공 줄을 얻지 못했다'); return; }
    ok('CSV 내려받기 다시 클릭', await domClick(p, CSV + ' button', /직접 신고용 내려받기/));
    const twice = await until(p, async () => (((await dl()).length === 2) ? true : null), 40000, 300);
    ok('파일이 한 번 더 나간다(__dl=2)', !!twice, JSON.stringify(await dl()));
    const after = await until(p, async () => (await surface(CSV + ' [data-surface=anchor-done]')) || null, 20000, 300);
    ok('성공 한 줄이 글자 그대로 같다(같은 tx·같은 시각)', after === csvDone, after);
  });

  await run('실패 → 재시도 → 성공', async () => {
    const c = await control({ failing: true, reset: true });
    ok('실패 스위치 on + 저장소 초기화', c.status === 200 && c.body && c.body.data && c.body.data.failing === true && c.body.data.records === 0, JSON.stringify(c.body));
    await openExport();
    ok('XLSX 내려받기 클릭', await domClick(p, XLSX + ' button', /세무사 전달용 내려받기/));

    const failed = await until(p, async () => (await surface(XLSX + ' [data-surface=anchor-failed]')) || null, 75000, 300);
    ok('실패 줄(data-surface=anchor-failed) + 사유', !!failed, failed);
    ok('"다시 시도" 버튼(data-surface=anchor-retry) 1개', (await count(p, XLSX + ' [data-surface=anchor-retry]')) === 1);
    ok('실패했으므로 파일은 나가지 않았다(__dl=0)', (await dl()).length === 0, '사유: ' + failed);
    ok('성공 줄은 없다', (await count(p, XLSX + ' [data-surface=anchor-done]')) === 0);
    await shot(p, 'anchor_failed');

    const c2 = await control({ failing: false });
    ok('실패 스위치 off', c2.status === 200 && c2.body && c2.body.data && c2.body.data.failing === false, JSON.stringify(c2.body));
    ok('"다시 시도" 클릭', await domClick(p, XLSX + ' [data-surface=anchor-retry]'));

    const done = await until(p, async () => (await surface(XLSX + ' [data-surface=anchor-done]')) || null, 75000, 400);
    ok('재시도로 성공 한 줄에 도달', !!done && /체인에 등록됨/.test(done), done);
    ok('실패 줄·다시 시도 버튼은 사라진다', (await count(p, XLSX + ' [data-surface=anchor-failed]')) === 0 && (await count(p, XLSX + ' [data-surface=anchor-retry]')) === 0);
    const names = await dl();
    ok('그제서야 파일이 한 번 나간다(.xlsx)', names.length === 1 && /^verawallet-신고근거-.+\.xlsx$/.test(names[0]), JSON.stringify(names));
    await shot(p, 'anchor_retry_done');
  });

  await run('게이트 줄이 껍데기를 넘지 않는다', async () => {
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
