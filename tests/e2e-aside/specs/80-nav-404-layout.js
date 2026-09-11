// 80: 공통 껍데기 — 하단 탭, 404, 면책 푸터, 가로 오버플로. 모든 화면을 한 바퀴 돈다.
const p = await newPage();
const s = await ensureLogin(p);
const authed = !!(s && s.didVerified);
const TABS = [['/dashboard', '거래'], ['/tax', '룰셋 비교'], ['/wallets', '지갑'], ['/export', '내보내기']];

section('80 하단 탭');
if (!authed) { skip('탭 검증', '인증 세션 없음'); }
else await run('탭 순회', async () => {
  await go(p, '/dashboard');
  ok('data-testid=app-nav 존재', (await count(p, '[data-testid=app-nav]')) === 1);
  ok('탭 4개(거래·룰셋 비교·지갑·내보내기)', (await p.evaluate(() => [...document.querySelectorAll('[data-testid=app-nav] a')].map((a) => a.textContent.trim()).join(','))) === '거래,룰셋 비교,지갑,내보내기');
  for (const [href, label] of TABS) {
    await p.locator('[data-testid=app-nav] a[href="' + href + '"]').click();
    const arrived = await until(p, async () => ((await path(p)).startsWith(href) ? true : null), 8000);
    ok('탭 "' + label + '" 클릭 → ' + href, !!arrived, await path(p));
    const cur = await p.evaluate(() => { const a = document.querySelector('[data-testid=app-nav] a[aria-current=page]'); return a ? a.textContent.trim() : null; });
    ok('aria-current=page 가 "' + label + '"', cur === label, cur);
  }
});
await run('플랜은 탭이 아니지만 탭이 보이고 활성 탭은 없다', async () => {
  await go(p, '/plan');
  ok('/plan 에서 app-nav 노출', (await count(p, '[data-testid=app-nav]')) === 1);
  ok('/plan 에서 aria-current 없음', (await count(p, '[data-testid=app-nav] a[aria-current=page]')) === 0);
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
  ok('탈출 링크 "거래로 이동"→/dashboard, "지갑 목록"→/wallets', (await attr(p, '[data-surface=not-found] a[href="/dashboard"]', 'href')) === '/dashboard' && (await attr(p, '[data-surface=not-found] a[href="/wallets"]', 'href')) === '/wallets');
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
for (const r of ['/dashboard', '/wallets', '/tax', '/plan', '/export', '/connect-wallet', '/plan']) {
  await run(r, async () => {
    await go(p, r, 3000);
    const v = await viewport(p);
    ok(r + ' 문서 폭이 뷰포트를 넘지 않음', v.scrollW <= v.w + 1, 'scrollW=' + v.scrollW + ' w=' + v.w);
  });
}
await closePage(p);
