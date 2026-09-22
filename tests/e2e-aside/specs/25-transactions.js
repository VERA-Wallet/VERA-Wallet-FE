// 25: 거래 /transactions — 요약에서 떼어 낸 전체 거래 목록. 상단(제목·검색·필터·탭)은 붙어 있고 목록만 흐른다.
const p = await newPage();
const s = await ensureLogin(p);
const ROW = 'button[data-event-id]';
if (!s) { ok('로그인', false, '세션 확보 실패'); }
else if (!s.walletAddress) {
  section('25 거래(DID-only)');
  await run('빈 상태', async () => {
    await go(p, '/transactions', 2500);
    ok('거래 목록 훅이 붙지 않음(헤더 표면 없음)', (await count(p, '[data-surface=transactions-header]')) === 0);
    ok('"지갑 연결하기" CTA → /connect-wallet', (await domCount(p, 'a[href^="/connect-wallet"]', /^지갑 연결하기$/)) >= 1);
  });
} else {
  // 목록은 **창**(render window)으로 잘라 그린다 — 처음 50줄만 DOM에 올리고 바닥에 닿을 때마다 늘린다.
  // 그래서 "행 수 = 건수" 비교는 건수가 50을 넘는 순간 거짓이 된다. 대신 목록 밑의 창 표시
  // (`[data-surface=list-window]`의 "그린 줄/전체건")가 말하는 **전체**와 비교한다 —
  // 그 숫자는 필터가 걸러 낸 전량이라 시트 건수·탭 배지와 같은 것을 세고 있다.
  const listTotal = async () => p.evaluate(() => {
    const node = document.querySelector('[data-surface=list-window]');
    const m = node && node.textContent.match(/([\d,]+)\s*\/\s*([\d,]+)건/);
    return m ? Number(m[2].replace(/,/g, '')) : null;
  });
  section('25 거래 렌더');
  await run('헤더·목록', async () => {
    await go(p, '/transactions', 4000);
    await until(p, async () => ((await count(p, ROW)) >= 1 ? true : null), 15000);
    ok('data-surface=transactions-header + h1 "거래"', (await count(p, '[data-surface=transactions-header]')) === 1 && (await domCount(p, 'h1', /^거래$/)) === 1);
    const rows = await count(p, ROW);
    ok('거래 행 ≥ 10', rows >= 10, 'rows=' + rows);
    // 창을 말없이 자르면 목록이 50건짜리인 척한다. 그려진 줄과 전체 건수를 함께 말하는지 본다.
    const total = await listTotal();
    ok('창 표시(data-surface=list-window)가 "그린 줄/전체건"을 말한다', total !== null && rows <= total, 'rows=' + rows + ' total=' + total);
    ok('한 번에 50줄까지만 그린다(실지갑 1,300건을 통째로 그리면 화면이 멎는다)', rows <= 50, 'rows=' + rows);
    ok('행마다 data-event-label', (await count(p, ROW + ' [data-event-label]')) >= 10);
    ok('탭 "전체 거래 N" · "확인 필요 N"', (await count(p, '[role=tablist][aria-label="거래 필터"] [role=tab]')) === 2);
    ok('검색 입력(aria-label=거래 검색)', (await count(p, 'input[aria-label="거래 검색"]')) === 1);
    const first = await rect(p, ROW);
    ok('첫 거래 행이 첫 화면 안에서 시작(top < 400, 계획 수용 기준) — 옛 화면은 1,200px 아래였다', first && first.y < 400, JSON.stringify(first));
    ok('목록에 판정 도장 배지 없음(상세에서만 말한다)', !(await domHas(p, ROW, /^(수신|송금|이동|브릿지|스왑|미분류).*(취득|양도|비과세|계산 제외)/)));
    ok('금지 용어 없음(세액·납부할 세금·신고서)', !(await has(p, /세액|납부할 세금|신고서/)));
    ok('가로 스크롤 없음', await noHorizontalOverflow(p));
    await shot(p, 'transactions');
  });
  await run('상단 고정', async () => {
    await p.evaluate(() => window.scrollTo(0, 1500)); await wait(500);
    const head = await rect(p, '[data-surface=transactions-header]');
    ok('1,500px 스크롤 뒤에도 헤더가 뷰포트 맨 위(sticky)', head && head.y >= -1 && head.y <= 1, JSON.stringify(head));
    await p.evaluate(() => window.scrollTo(0, 0)); await wait(300);
  });
  await run('창 늘리기', async () => {
    const total = await listTotal();
    if (total === null || total <= 50) { skip('창 늘리기', '거래가 50건 이하라 창이 처음부터 전부를 덮는다'); return; }
    // 스크롤로만 늘어나면 키보드 사용자와 관찰자 없는 환경에서는 창이 영영 50줄에 멈춘다.
    const before = await count(p, ROW);
    ok('「더 보기」 클릭 → 그려진 줄이 늘어난다', await domClick(p, '[data-surface=list-window] button', /^더 보기$/) && !!(await until(p, async () => ((await count(p, ROW)) > before ? true : null), 5000)), 'before=' + before + ' after=' + (await count(p, ROW)));
    ok('창 표시가 늘어난 줄 수를 그대로 말한다', (await p.evaluate(() => Number(document.querySelector('[data-surface=list-window]').textContent.match(/([\d,]+)\s*\//)[1].replace(/,/g, '')))) === (await count(p, ROW)));
    ok('전체 건수는 창이 늘어도 그대로', (await listTotal()) === total, 'total=' + (await listTotal()) + ' before=' + total);
    await go(p, '/transactions', 4000);
    await until(p, async () => ((await count(p, ROW)) >= 1 ? true : null), 15000);
  });

  section('25 필터');
  await run('필터 칩 → 시트 → 선택 → 해제', async () => {
    const keys = await p.evaluate(() => [...document.querySelectorAll('[data-surface=transaction-filters] button[data-filter]')].map((b) => b.getAttribute('data-filter')));
    ok('필터 칩이 한 줄(같은 y)', keys.length >= 1 && await p.evaluate(() => { const rs = [...document.querySelectorAll('[data-surface=transaction-filters] button[data-filter]')].map((b) => b.getBoundingClientRect().top); return rs.every((t) => Math.abs(t - rs[0]) < 1); }), keys.join(','));
    const key = keys.includes('chain') ? 'chain' : keys[0];
    const label = { wallet: '지갑 필터', year: '연도 필터', chain: '체인 필터', group: '판정 필터' }[key];
    // 창이 생긴 뒤로 행 수는 min(전체, 50)이라 필터 전후를 재는 기준이 못 된다 — 전체 건수로 잰다.
    const before = await listTotal();
    ok('칩(' + key + ') 클릭 → 시트 열림', await domClick(p, '[data-filter="' + key + '"]') && !!(await until(p, async () => ((await count(p, '[role=dialog] [aria-label="' + label + '"]')) === 1 ? true : null), 5000)));
    ok('시트 항목마다 건수("N건")', await p.evaluate((label) => [...document.querySelectorAll('[aria-label="' + label + '"] button')].every((b) => /[\d,]+건$/.test(b.textContent.trim())), label));
    const picked = await p.evaluate((label) => { const b = [...document.querySelectorAll('[aria-label="' + label + '"] button')][1]; if (!b) return null; const t = b.textContent.trim(); b.click(); return t; }, label);
    await wait(1200);
    ok('두 번째 항목 선택 → 시트 닫힘', picked !== null && (await count(p, '[role=dialog] [aria-label="' + label + '"]')) === 0, picked);
    const n = picked ? Number(picked.match(/([\d,]+)건$/)[1].replace(/,/g, '')) : -1;
    const after = await listTotal();
    ok('목록 전체 건수 = 시트가 말한 건수', after === n, 'sheet=' + n + ' total=' + after + ' before=' + before);
    ok('칩이 선택값을 말한다(" · ")', await domHas(p, '[data-filter="' + key + '"]', / · /));
    await domClick(p, '[data-filter="' + key + '"]'); await wait(700);
    await p.evaluate((label) => { const b = document.querySelector('[aria-label="' + label + '"] button'); if (b) b.click(); }, label); await wait(1000);
    ok('"전체"로 되돌리면 전체 건수 원복', (await listTotal()) === before, 'total=' + (await listTotal()) + ' before=' + before);
  });
  await run('확인 필요 탭', async () => {
    await domClick(p, '[role=tablist][aria-label="거래 필터"] [role=tab]', /확인 필요/); await wait(1500);
    ok('확인 필요 탭 aria-selected', (await domCount(p, '[role=tab][aria-selected=true]', /확인 필요/)) === 1);
    const badge = await p.evaluate(() => { const t = [...document.querySelectorAll('[role=tab]')].find((t) => /확인 필요/.test(t.textContent)); return Number((t.textContent.match(/([\d,]+)$/) || [0, '0'])[1].replace(/,/g, '')); });
    // 배지는 그 탭의 전량을 센다 — 창이 자른 행 수가 아니라 창 표시가 말하는 전체와 맞아야 한다.
    ok('탭 배지 수 = 목록 전체 건수', (await listTotal()) === badge, 'badge=' + badge + ' total=' + (await listTotal()) + ' rows=' + (await count(p, ROW)));
    await domClick(p, '[role=tablist][aria-label="거래 필터"] [role=tab]', /전체 거래/); await wait(1000);
  });
  await run('?tab=review 딥링크', async () => {
    await go(p, '/transactions?tab=review', 3500);
    ok('도착 즉시 확인 필요 탭 선택', (await domCount(p, '[role=tab][aria-selected=true]', /확인 필요/)) === 1);
    await go(p, '/transactions', 3500);
    await until(p, async () => ((await count(p, ROW)) >= 1 ? true : null), 15000);
  });

  section('25 검색');
  await run('자산 심볼로 좁히기', async () => {
    // 검색도 창 아래의 전체 건수로 잰다 — 행 수는 50에서 잘려 "좁혀졌는가"를 말해 주지 못한다.
    const before = await listTotal();
    const symbol = await p.evaluate(() => { const row = document.querySelector('button[data-event-id]'); const m = row && row.innerText.match(/[\d.,]+\s+([A-Za-z][A-Za-z0-9]{1,9})/); return m ? m[1] : null; });
    if (!symbol) { skip('검색', '첫 행에서 심볼을 읽지 못함'); return; }
    const fill = async (v) => p.evaluate((v) => { const el = document.querySelector('input[aria-label="거래 검색"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await fill(symbol); await wait(1000);
    const hit = await listTotal();
    ok('"' + symbol + '" 검색 → 1건 이상, 전체 이하', hit >= 1 && hit <= before, 'hit=' + hit + ' before=' + before);
    await fill('zzzz-없는-검색어'); await wait(800);
    ok('없는 검색어 → 0건 + 빈 문구', (await count(p, ROW)) === 0 && await has(p, /표시할 거래가 없습니다|검색/));
    await fill(''); await wait(800);
    ok('지우면 원복', (await listTotal()) === before, 'total=' + (await listTotal()) + ' before=' + before);
  });

  section('25 상세·스팸');
  await run('거래 상세 바텀시트', async () => {
    ok('첫 거래 행 클릭', await domClick(p, ROW)); await wait(1200);
    ok('role=dialog aria-label="거래 상세" 열림', (await count(p, '[role=dialog][aria-label="거래 상세"]')) === 1);
    ok('상세에 분류 select(#classification)·사유 입력(#reason)', (await count(p, '#classification')) === 1 && (await count(p, '#reason')) === 1);
    ok('금액 덮어쓰기 details(data-surface=value-override)', (await count(p, '[data-surface=value-override]')) === 1);
    ok('탐색기 링크(외부 tx URL)', (await count(p, '[role=dialog] a[href*="scan"]')) >= 1);
    await shot(p, 'transactions_detail');
    ok('바텀시트 닫기', await domClick(p, '[aria-label="바텀시트 닫기"]')); await wait(600);
    ok('닫힘', (await count(p, '[role=dialog][aria-label="거래 상세"]')) === 0);
  });
  await run('스팸 보기(보기 전용)', async () => {
    if (!(await domHas(p, '[data-surface=ledger-omissions]', /스팸으로 분류된 [\d,]+건/))) { skip('스팸 보기', '스팸으로 분류된 거래가 없다'); return; }
    const n = await p.evaluate(() => Number(document.querySelector('[data-surface=ledger-omissions]').textContent.match(/스팸으로 분류된 ([\d,]+)건/)[1].replace(/,/g, '')));
    ok('"보기" 클릭', await domClick(p, '[data-surface=ledger-omissions] button', /^보기$/)); await wait(1200);
    ok('보기 전용 안내', await has(p, /보기 전용이라 계산에도, 확인 필요에도 들어가지 않습니다/));
    // 스팸 목록도 같은 창을 쓴다 — 50건을 넘으면 그려진 행 수는 고지 건수와 다르다.
    ok('스팸 전체 건수 = 고지한 건수, 누를 수 있는 행 없음', (await listTotal()) === n && (await count(p, ROW)) === 0, 'n=' + n + ' total=' + (await listTotal()) + ' rows=' + (await count(p, '[data-event-id]')) + ' buttons=' + (await count(p, ROW)));
    ok('"되돌리기" 없음(BE 허용 여부 미확인)', !(await has(p, /되돌리기/)));
    await shot(p, 'transactions_spam');
    ok('"원장으로 돌아가기" → 원장 복귀', await domClick(p, '[data-surface=ledger-omissions] button', /원장으로 돌아가기/) && !!(await until(p, async () => ((await count(p, ROW)) >= 1 ? true : null), 5000)));
  });
}
await closePage(p);
