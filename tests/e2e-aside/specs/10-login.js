// 10: 로그인 /login — 로그아웃 → 로그인 화면 → mock 본인 확인 → 자동 진행 → 세션. 화면은 사용자 말로 말한다(DID·클레임 없음).
const p = await newPage();
section('10 로그아웃');
await run('로그아웃 후 보호 화면 진입', async () => {
  await ensureLogin(p);
  const st = await logout(p);
  ok('POST /api/auth/logout 2xx/204', st >= 200 && st < 300, 'status=' + st);
  const s = await session(p);
  ok('세션 didVerified=false, 지갑 null', s && s.didVerified === false && s.walletAddress === null, JSON.stringify(s));
  for (const r of ['/dashboard', '/transactions', '/wallets', '/tax', '/plan', '/settings', '/export', '/export/basis', '/export/issues', '/export/settings', '/export/compare', '/connect-wallet']) {
    await go(p, r, 1800);
    ok(r + ' → /login 리다이렉트', (await path(p)).startsWith('/login'), await path(p));
  }
  await go(p, '/', 1800);
  ok('/ → /login', (await path(p)).startsWith('/login'));
});
section('10 로그인 화면');
await run('렌더', async () => {
  await go(p, '/login', 2000);
  ok('data-surface=did-login', (await count(p, '[data-surface=did-login]')) === 1);
  const body = await text(p);
  ok('내부 용어가 화면에 없다("DID"·"클레임" 0회)', !/DID|클레임/.test(body), (body.match(/DID|클레임/g) || []).join(','));
  ok('제목이 앱이 해 주는 일을 말한다(h1 1개, 지갑·과세·계산 중 하나 이상)', (await count(p, 'h1')) === 1 && /지갑|과세|계산/.test(await p.evaluate(() => document.querySelector('h1').innerText)));
  ok('신분증은 본인 확인, 계산은 거주 국가 규칙 — 신분증이 거주 국가를 증명한다고 말하지 않는다', /모바일신분증으로 본인 확인/.test(body) && /거주 국가에 맞는 규칙/.test(body) && !/신분증으로 거주 국가를 확인/.test(body));
  ok('온보딩 단계 칩 없음', (await count(p, '[aria-label="온보딩 진행 단계"]')) === 0);
  ok('시작 버튼 1개("모바일신분증으로 시작하기" 또는 mock QR "QR/딥링크 제시")', (await domCount(p, 'button', /^(모바일신분증으로 시작하기|QR\/딥링크 제시)$/)) === 1);
  // 시작 카드는 화면 **아래**에 붙는다(엄지가 닿는 자리). 위에 두면 긴 화면에서 버튼 아래가 통째로 빈다.
  const lay = await p.evaluate(() => { const card = document.querySelector('[data-surface=did-login]').getBoundingClientRect(); const btn = [...document.querySelectorAll('button')].find((b) => /시작하기|QR\/딥링크 제시/.test(b.textContent)).getBoundingClientRect(); const foot = document.querySelector('[data-testid=disclaimer-footer]'); const floor = foot ? foot.getBoundingClientRect().top : innerHeight; const list = document.querySelector('main ul'); return { vh: innerHeight, floor: Math.round(floor), cardBottom: Math.round(card.bottom), btnTop: Math.round(btn.top), btnBottom: Math.round(btn.bottom), points: list ? list.querySelectorAll('li').length : 0, listBottom: list ? Math.round(list.getBoundingClientRect().bottom) : 0 }; });
  ok('시작 카드가 화면 아래에 붙어 있다(카드 아래 여백 ≤ 80px)', lay.floor - lay.cardBottom >= 0 && lay.floor - lay.cardBottom <= 80, JSON.stringify(lay));
  ok('시작 버튼이 화면 아래쪽 절반에 있다(엄지 영역)', lay.btnTop >= lay.vh / 2, 'btnTop=' + lay.btnTop + ' vh=' + lay.vh);
  ok('제목과 카드 사이는 설명 두 줄이 채운다(빈 채로 두지 않는다)', lay.points === 2 && lay.listBottom < lay.btnTop, 'points=' + lay.points);
  ok('금지 용어 없음(세액·납부할 세금·신고서)', !/세액|납부할 세금|신고서/.test(body));
  ok('하단 탭 없음(온보딩)', (await count(p, '[data-testid=app-nav]')) === 0);
  const o = await shellOverflow(p);
  ok('껍데기(448px) 밖으로 넘치는 요소 없음', o.count === 0, 'count=' + o.count + ' worst=' + o.worst);
  await shot(p, 'login');
});
await run('거주 국가는 버튼 아래 접힌 줄 — 첫 입력은 아니지만 고를 길은 늘 있다', async () => {
  // 거주 국가는 사용자가 신고하는 값이다(BE는 실제 인증 토큰이 있어도 요청의 country를 세션 거주국으로 쓴다).
  // 그래서 인증 모드와 무관하게 이 줄은 있어야 한다 — 감추면 해외 거주자가 KR로 굳는다.
  ok('거주국 그룹은 details 안에 있고 기본은 닫힘', await p.evaluate(() => { const g = document.querySelector('[aria-label="거주국 선택"]'); const d = g && g.closest('details'); return !!d && d.open === false; }));
  ok('접힌 줄이 지금 값을 말한다("거주 국가: 한국 · 바꾸기")', await domHas(p, 'details summary', /거주 국가:\s*한국\s*· 바꾸기/));
  ok('주 버튼이 거주 국가 줄보다 위에 있다', await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((b) => /시작하기|QR\/딥링크 제시/.test(b.textContent)).getBoundingClientRect(); const d = document.querySelector('details').getBoundingClientRect(); return b.bottom <= d.top + 1; }));
  await p.evaluate(() => { document.querySelector('[aria-label="거주국 선택"]').closest('details').open = true; }); await wait(300);
  ok('열면 4개(KR·US·UK·DE), 기본 KR', (await p.evaluate(() => [...document.querySelectorAll('[aria-label="거주국 선택"] button')].map((b) => b.textContent.trim() + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(','))) === 'KR*,US,UK,DE');
  ok('신분증은 본인 확인에만 쓴다고 말한다', await has(p, /모바일신분증은 본인 확인에만 쓰고/));
  await domClick(p, '[aria-label="거주국 선택"] button', /^US$/); await wait(300);
  ok('US 선택 → 접힌 줄 문구도 "미국"', await domHas(p, 'details summary', /거주 국가:\s*미국/));
  await domClick(p, '[aria-label="거주국 선택"] button', /^KR$/); await wait(300);
  ok('KR 복귀', await domHas(p, 'details summary', /거주 국가:\s*한국/));
});
section('10 본인 확인');
await run('인증 → 클릭 없이 도착', async () => {
  const t0 = Date.now();
  await domClick(p, 'button', /모바일신분증으로 시작하기|QR\/딥링크 제시/);
  await wait(600); await domClick(p, 'button', /^제시 완료$/);
  // 성공 표시는 약 1초만 뜬다 — 촘촘히 폴링해야 잡힌다. 못 잡아도 도착 판정은 아래에서 따로 한다.
  let sawSuccess = false, sawOldButton = false;
  const arrived = await until(p, async () => {
    const st = await p.evaluate(() => ({ path: location.pathname, ok: /본인 확인이 끝났어요/.test(document.body.innerText), old: [...document.querySelectorAll('button')].some((b) => /대시보드로 이동/.test(b.textContent)) }));
    if (st.ok) sawSuccess = true; if (st.old) sawOldButton = true;
    return st.path !== '/login' ? st.path : null;
  }, 20000, 150);
  const s = await session(p);
  ok('세션 didVerified=true · countryCode=KR', !!s && s.didVerified && s.countryCode === 'KR', JSON.stringify(s));
  ok('성공 표시 "본인 확인이 끝났어요"가 잠깐 뜬다', sawSuccess);
  ok('"대시보드로 이동" 버튼이 없다(클릭 0회)', !sawOldButton);
  const expected = s && s.walletAddress ? '/dashboard' : '/connect-wallet';
  ok('지갑 ' + (s && s.walletAddress ? '있음 → /dashboard' : '없음 → /connect-wallet') + ' 에 자동 도착', arrived === expected, 'arrived=' + arrived + ' in ' + (Date.now() - t0) + 'ms');
  ok('같은 사용자라 지갑 바인딩이 유지된다(BE mock identity)', !!s && (s.walletAddress === null || /^0x[0-9a-fA-F]{40}$/.test(s.walletAddress)), 'wallet=' + (s && s.walletAddress));
});
await run('도착 직후 요약은 모르는 것을 0이라 말하지 않는다', async () => {
  const s = await session(p);
  if (!(s && s.walletAddress)) { skip('로딩 중 0건', '지갑 미연결 세션은 빈 요약이라 해당 없음'); return; }
  // 로컬에서는 거래가 너무 빨리 와서 로딩 구간을 폴링으로 못 잡는다. 거래 목록 응답만 1.5초 늦춰 그 구간을 연다:
  // 거래를 부르지 않는 화면(/settings)에 전체 로드로 들어가 캐시를 비우고, fetch를 감싼 뒤 탭 링크로 클라이언트 이동한다.
  // (RSC 내비게이션이 깨지지 않게 URL 객체·Request 입력을 그대로 넘긴다.)
  await go(p, '/settings', 2500);
  await p.evaluate(() => { const of = window.fetch; window.fetch = function (input, init) { const u = typeof input === 'string' ? input : (input && input.url) ? input.url : String(input); if (/\/api\/events(\?|$)/.test(u)) return new Promise((r) => setTimeout(r, 1500)).then(() => of.call(this, input, init)); return of.call(this, input, init); }; });
  await p.locator('[data-testid=app-nav] a[href="/dashboard"]').click();
  const frames = [];
  await until(p, async () => { const f = await p.evaluate(() => ({ path: location.pathname, t: document.body.innerText, skel: document.querySelectorAll('[data-surface=recent-transaction-skeleton]').length, rows: document.querySelectorAll('[data-surface=recent-transactions] [data-event-id]').length })); if (f.path === '/dashboard') frames.push(f); return f.path === '/dashboard' && f.rows >= 1 ? true : null; }, 25000, 100);
  const loading = frames.filter((f) => f.rows === 0);
  ok('로딩 구간을 실제로 관찰했다(프레임 ≥ 3)', loading.length >= 3, 'loading=' + loading.length + ' total=' + frames.length);
  ok('로딩 중 어느 프레임에도 "0건"이 없다', loading.every((f) => !/(^|[^\d,])0건/.test(f.t)), (loading.find((f) => /(^|[^\d,])0건/.test(f.t)) || { t: '' }).t.slice(0, 120));
  ok('로딩 중에는 "전체 …건 보기" 링크를 그리지 않는다', loading.every((f) => !/전체 [\d,]+건 보기/.test(f.t)));
  ok('로딩 중에는 행 스켈레톤 3줄 + "거래를 불러오는 중입니다"', loading.some((f) => f.skel === 3 && /거래를 불러오는 중입니다/.test(f.t)), 'skel=' + loading.map((f) => f.skel).join(','));
  const last = frames[frames.length - 1] || { t: '', skel: -1 };
  ok('도착 후에는 "전체 N건 보기"(N≥1)이고 스켈레톤은 사라진다', /전체 [1-9][\d,]*건 보기/.test(last.t) && last.skel === 0);
});
await run('인증된 상태에서 /login 재진입 → /dashboard', async () => {
  await go(p, '/login', 2000);
  ok('/login → /dashboard', (await path(p)).startsWith('/dashboard'), await path(p));
});
await closePage(p);
