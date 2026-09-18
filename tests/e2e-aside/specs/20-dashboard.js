// 20: 요약 /dashboard — 거래 목록·필터·상세는 25-transactions.js 가 맡는다.
const p = await newPage();
const s = await ensureLogin(p);
if (!s) { ok('로그인', false, '세션 확보 실패'); }
else if (!s.walletAddress) {
  section('20 대시보드(DID-only 빈 상태)');
  await run('빈 상태', async () => {
    await go(p, '/dashboard', 2500);
    ok('"데이터 불러오기" CTA → /connect-wallet', (await domCount(p, 'a[href^="/connect-wallet"]', /데이터 불러오기/)) >= 1);
    ok('거래 목록 훅이 붙지 않음(요약 표면 없음)', (await count(p, '[data-surface=dashboard-summary]')) === 0);
  });
} else {
  section('20 대시보드 렌더');
  await run('요약·그래프·신뢰도', async () => {
    await go(p, '/dashboard', 4000);
    ok('data-surface=dashboard-summary', (await count(p, '[data-surface=dashboard-summary]')) === 1);
    ok('헤더 "요약"(옛 "거래 요약" 아님) + 기간 버튼("기간 바꾸기")', (await domCount(p, 'h1', /^요약$/)) === 1 && !(await has(p, /거래 요약/)) && (await domCount(p, 'button', /기간 바꾸기/)) === 1);
    ok('누적 순유입 그래프(data-surface=dashboard-flow, testid flow-total/flow-line)', (await count(p, '[data-surface=dashboard-flow]')) === 1 && (await count(p, '[data-testid=flow-total]')) === 1 && (await count(p, '[data-testid=flow-line]')) === 1);
    ok('기간 프리셋 5개(1개월·3개월·6개월·1년·전체)', (await domCount(p, 'button', /^(1개월|3개월|6개월|1년|전체)$/)) >= 5);
    ok('계산 신뢰도 블록(aria-label=계산 신뢰도)', (await count(p, '[data-surface=dashboard-confidence]')) === 1);
    ok('예상 손익·계산 대상 이벤트 문구', await has(p, /예상 손익/) && await has(p, /계산 대상 이벤트/));
    ok('금지 용어 없음(세액·납부할 세금·신고서)', !(await has(p, /세액|납부할 세금|신고서/)));
    await shot(p, 'dashboard');
  });
  await run('목록은 요약에 없다 — 문만 남는다', async () => {
    ok('거래 필터 탭·지갑 select·필터 그룹이 요약에 없음', (await count(p, '[role=tablist][aria-label="거래 필터"]')) === 0 && (await count(p, '#dashboard-wallet-filter')) === 0 && (await count(p, '[data-surface=transaction-filters]')) === 0);
    const recent = await count(p, '[data-surface=recent-transactions] button[data-event-id]');
    ok('최근 거래 1~3건(data-surface=recent-transactions)', recent >= 1 && recent <= 3, 'recent=' + recent);
    ok('"전체 N건 보기" → /transactions', (await domCount(p, '[data-surface=recent-transactions] a[href="/transactions"]', /^전체 [\d,]+건 보기$/)) === 1);
    ok('설정 톱니(aria-label=설정) → /settings', (await attr(p, '[data-surface=dashboard-summary] a[aria-label="설정"]', 'href')) === '/settings');
    // 계획은 1,100px를 적었지만 실제 그래프 블록이 428px라 실측은 1,307px다(2026-09-17). 기준을 실측에 맞춰 적고,
    // 목록이 다시 요약으로 새어 들어오면(행 하나 ≈ 76px × 수백) 바로 넘도록 여유는 100px만 둔다.
    const mainH = await p.evaluate(() => Math.round(document.querySelector('main').getBoundingClientRect().height));
    ok('요약 화면 전체 높이 ≤ 1,400px', mainH <= 1400, 'mainH=' + mainH);
  });
  await run('확인 필요 카드 → 거래 탭 확인 필요', async () => {
    const nudge = await count(p, '[data-surface=review-nudge]');
    if (nudge === 0) { skip('확인 필요 카드', '확인 필요 0건이라 카드가 뜨지 않는다(설계)'); return; }
    ok('카드 문구 "확인 필요 N건"', await domHas(p, '[data-surface=review-nudge]', /확인 필요 [\d,]+건/));
    await p.locator('[data-surface=review-nudge]').click();
    const arrived = await until(p, async () => ((await path(p)) === '/transactions?tab=review' ? true : null), 8000);
    ok('클릭 → /transactions?tab=review', !!arrived, await path(p));
    const selected = await until(p, async () => ((await domCount(p, '[role=tab][aria-selected=true]', /확인 필요/)) === 1 ? true : null), 8000);
    ok('도착하면 확인 필요 탭이 선택돼 있다', !!selected);
    await go(p, '/dashboard', 3500);
  });
  await run('최근 거래 행 → 상세 시트', async () => {
    ok('최근 거래 첫 행 클릭', await domClick(p, '[data-surface=recent-transactions] button[data-event-id]')); await wait(1200);
    ok('role=dialog aria-label="거래 상세" 열림', (await count(p, '[role=dialog][aria-label="거래 상세"]')) === 1);
    ok('바텀시트 닫기', await domClick(p, '[aria-label="바텀시트 닫기"]')); await wait(600);
  });
  section('20 상호작용');
  await run('금액 가리기 토글', async () => {
    // 이전 실행이 남긴 localStorage 상태(가려짐)가 있을 수 있어 현재 라벨에서 출발한다.
    const label = async () => p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((b) => /^금액 (가리기|표시)$/.test(b.textContent.trim())); return b ? b.textContent.trim() : null; });
    const flowHasAmount = async () => /₩[\d,]{4,}/.test(await p.evaluate(() => document.querySelector('[data-surface=dashboard-flow]').textContent));
    if ((await label()) === '금액 표시') { await domClick(p, 'button', /^금액 표시$/); await wait(500); }
    ok('초기: "금액 가리기" + 그래프에 ₩ 금액 보임', (await label()) === '금액 가리기' && await flowHasAmount());
    ok('금액 가리기 클릭', await domClick(p, 'button', /^금액 가리기$/)); await wait(500);
    ok('"금액 표시"로 바뀌고 그래프 블록의 ₩ 금액이 가려진다', (await label()) === '금액 표시' && !(await flowHasAmount()));
    await domClick(p, 'button', /^금액 표시$/); await wait(500);
    ok('다시 표시 → 원복', (await label()) === '금액 가리기' && await flowHasAmount());
  });
  await run('기간 선택', async () => {
    ok('기간 바꾸기 클릭', await domClick(p, 'button', /기간 바꾸기/)); await wait(800);
    ok('기간 선택 패널(data-surface=dashboard-period-picker) + 시작일/종료일 입력', (await count(p, '[data-surface=dashboard-period-picker]')) === 1 && (await count(p, 'input[aria-label="시작일"]')) === 1 && (await count(p, 'input[aria-label="종료일"]')) === 1);
    ok('안내가 목록을 말하지 않는다("그래프만 … 좁힙니다")', await has(p, /그래프만 이 기간으로 좁힙니다/) && !(await has(p, /목록과 그래프만/)));
    await p.keyboard.press('Escape').catch(() => null); await wait(400);
    await domClick(p, '[aria-label="바텀시트 닫기"]'); await wait(400);
  });
}
await closePage(p);
