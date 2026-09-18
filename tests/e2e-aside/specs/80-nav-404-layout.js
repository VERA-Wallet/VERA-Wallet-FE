// 80: 공통 껍데기 — 하단 탭, 404, 면책 푸터, 가로 오버플로. 모든 화면을 한 바퀴 돈다.
const p = await newPage();
const s = await ensureLogin(p);
const authed = !!(s && s.didVerified);
const TABS = [['/dashboard', '요약'], ['/transactions', '거래'], ['/wallets', '지갑'], ['/export', '리포트']];

section('80 하단 탭');
if (!authed) { skip('탭 검증', '인증 세션 없음'); }
else await run('탭 순회', async () => {
  await go(p, '/dashboard');
  ok('data-testid=app-nav 존재', (await count(p, '[data-testid=app-nav]')) === 1);
  const labels = await p.evaluate(() => [...document.querySelectorAll('[data-testid=app-nav] a')].map((a) => a.textContent.trim().replace(/[\d,+]+$/, '')).join(','));
  ok('탭 4개(요약·거래·지갑·리포트) — 세금 탭은 리포트로 합쳐졌다', labels === '요약,거래,지갑,리포트' && (await count(p, '[data-testid=app-nav] a[href="/tax"]')) === 0, labels);
  ok('4개 라벨이 한 줄(같은 y, 줄바꿈 없음)·nav 폭 안', await p.evaluate(() => { const nav = document.querySelector('[data-testid=app-nav]').getBoundingClientRect(); const rs = [...document.querySelectorAll('[data-testid=app-nav] a')].map((a) => a.getBoundingClientRect()); return rs.every((r) => Math.abs(r.top - rs[0].top) < 1 && Math.abs(r.height - rs[0].height) < 1 && r.left >= nav.left - 1 && r.right <= nav.right + 1); }));
  const badge = await attr(p, '[data-testid=app-nav] a[href="/transactions"]', 'aria-label');
  const pending = (await json(p, '/api/events/summary')).body;
  const n = pending && pending.data ? pending.data.pendingReviewCount : null;
  if (n === null || n === undefined) skip('거래 탭 배지', '요약 API에서 pendingReviewCount를 읽지 못함');
  else {
    // 배지는 숫자가 아니라 점이다: 요약 API의 건수는 다리 단위, 거래 탭의 건수는 행 단위라 숫자를 달면 앱이 두 값을 말한다.
    ok('거래 탭 배지 = 확인 필요가 있으면 점(0이면 없음)', n > 0 ? badge === '거래 · 확인 필요 있음' && (await count(p, '[data-testid=app-nav] [data-badge=pending-review]')) === 1 : badge === null, 'aria-label=' + badge + ' n=' + n);
    ok('배지에 숫자가 없다(라벨이 숫자로 오염되지 않음)', (await p.evaluate(() => document.querySelector('[data-testid=app-nav] a[href="/transactions"]').textContent.trim())) === '거래');
  }
  for (const [href, label] of TABS) {
    await p.locator('[data-testid=app-nav] a[href="' + href + '"]').click();
    const arrived = await until(p, async () => ((await path(p)).startsWith(href) ? true : null), 8000);
    ok('탭 "' + label + '" 클릭 → ' + href, !!arrived, await path(p));
    const cur = await p.evaluate(() => { const a = document.querySelector('[data-testid=app-nav] a[aria-current=page]'); return a ? a.textContent.trim().replace(/[\d,+]+$/, '') : null; });
    ok('aria-current=page 가 "' + label + '"', cur === label, cur);
  }
});
await run('플랜은 탭이 아니지만 탭이 보이고 활성 탭은 없다', async () => {
  await go(p, '/plan');
  ok('/plan 에서 app-nav 노출', (await count(p, '[data-testid=app-nav]')) === 1);
  ok('/plan 에서 aria-current 없음', (await count(p, '[data-testid=app-nav] a[aria-current=page]')) === 0);
});
await run('설정도 탭이 아니지만 탭이 보인다', async () => {
  await go(p, '/settings');
  ok('/settings 에서 app-nav 노출 + 활성 탭 없음', (await count(p, '[data-testid=app-nav]')) === 1 && (await count(p, '[data-testid=app-nav] a[aria-current=page]')) === 0);
});
await run('온보딩 화면(connect-wallet)에서는 탭 숨김', async () => {
  await go(p, '/connect-wallet');
  ok('/connect-wallet 에서 app-nav 없음', (await count(p, '[data-testid=app-nav]')) === 0);
});

section('80 404');
await run('없는 경로', async () => {
  await go(p, '/nope-' + Date.now(), 2000);
  ok('data-surface=not-found 렌더', (await count(p, '[data-surface=not-found]')) === 1);
  ok('문구 "페이지를 찾을 수 없습니다" + code: 404', await has(p, /페이지를 찾을 수 없습니다/) && await has(p, /code: 404/));
  ok('탈출 링크 "거래로 이동"→/transactions, "지갑 목록"→/wallets', (await domCount(p, '[data-surface=not-found] a[href="/transactions"]', /거래로 이동/)) === 1 && (await attr(p, '[data-surface=not-found] a[href="/wallets"]', 'href')) === '/wallets');
  ok('404 에서 탭 숨김(탭 경로가 아님)', (await count(p, '[data-testid=app-nav]')) === 0);
});
await run('지갑 상세 주소 형식 오류 → 404', async () => {
  await go(p, '/wallets/0x123', 2000);
  ok('/wallets/0x123 → not-found 뷰', (await count(p, '[data-surface=not-found]')) === 1);
  ok('지갑 하위 경로라 탭은 보이고 "지갑" 활성', (await p.evaluate(() => { const a = document.querySelector('[data-testid=app-nav] a[aria-current=page]'); return a ? a.textContent.trim() : null; })) === '지갑');
});

section('80 면책 푸터');
await run('푸터 고정', async () => {
  await go(p, '/dashboard');
  ok('data-testid=disclaimer-footer 존재', (await count(p, '[data-testid=disclaimer-footer]')) === 1);
  ok('면책 문구(계산 보조 도구·세무 대리 아님)', await has(p, /계산 보조 도구/) && await has(p, /세무 대리 또는 세무 상담을 제공하지 않습니다/));
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await wait(400);
  const r = await rect(p, '[data-testid=disclaimer-footer]'); const v = await viewport(p);
  ok('스크롤 끝에서도 푸터가 뷰포트 안(sticky bottom)', r && r.bottom <= v.h + 1 && r.y >= 0, JSON.stringify(r));
  ok('탭 바가 푸터 바로 위(겹치지 않음)', await p.evaluate(() => { const n = document.querySelector('[data-testid=app-nav]').getBoundingClientRect(); const f = document.querySelector('[data-testid=disclaimer-footer]').getBoundingClientRect(); return n.bottom <= f.top + 1; }));
});

section('80 가로 오버플로(전 화면)');
for (const r of ['/dashboard', '/transactions', '/settings', '/wallets', '/plan', '/export', '/connect-wallet']) {
  await run(r, async () => {
    await go(p, r, 3000);
    const v = await viewport(p);
    ok(r + ' 문서 폭이 뷰포트를 넘지 않음', v.scrollW <= v.w + 1, 'scrollW=' + v.scrollW + ' w=' + v.w);
    // 데이터가 뜬 뒤에 재야 한다 — 목록이 비어 있으면 넘칠 것도 없다. 거래·세금은 수천 건이라 늦게 뜬다.
    if (r === '/transactions') await until(p, async () => ((await count(p, 'button[data-event-id]')) >= 1 ? true : null), 20000);
    if (r === '/export') await until(p, async () => ((await count(p, 'main li')) >= 3 ? true : null), 40000);
    const o = await shellOverflow(p);
    ok(r + ' 껍데기(448px) 밖으로 넘치는 요소 없음', o.count === 0, 'count=' + o.count + ' worst=' + o.worst);
  });
}
await closePage(p);
