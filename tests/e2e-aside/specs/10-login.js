// 10: 로그인 /login — 로그아웃 → 로그인 화면 → mock DID 인증 → 세션 → 리다이렉트.
const p = await newPage();
section('10 로그아웃');
await run('로그아웃 후 보호 화면 진입', async () => {
  await ensureLogin(p);
  const st = await logout(p);
  ok('POST /api/auth/logout 2xx/204', st >= 200 && st < 300, 'status=' + st);
  const s = await session(p);
  ok('세션 didVerified=false, 지갑 null', s && s.didVerified === false && s.walletAddress === null, JSON.stringify(s));
  for (const r of ['/dashboard', '/wallets', '/tax', '/plan', '/export', '/connect-wallet']) {
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
  ok('헤더 "DID로 안전하게 로그인하세요"', await has(p, /DID로 안전하게 로그인하세요/));
  ok('온보딩 단계: 거주국 인증(현재) · 지갑 연결 — 나중에 가능', (await count(p, '[aria-label="온보딩 진행 단계"]')) === 1 && await has(p, /거주국 인증/) && await has(p, /지갑 연결 — 나중에 가능/));
  ok('거주국 선택 4개(KR·US·UK·DE)', (await p.evaluate(() => [...document.querySelectorAll('[aria-label="거주국 선택"] button')].map((b) => b.textContent.trim()).join(','))) === 'KR,US,UK,DE');
  ok('하단 탭 없음(온보딩)', (await count(p, '[data-testid=app-nav]')) === 0);
  ok('mock 출처 칩 표시(OFF/ON 모두 mock DID)', (await count(p, '[data-testid=mock-provenance]')) >= 1);
  await shot(p, 'login');
});
await run('국가 선택이 안내 문구를 바꾼다', async () => {
  await domClick(p, '[aria-label="거주국 선택"] button', /^US$/); await wait(300);
  ok('US 선택 → 한국 거주 문구 사라짐', !(await has(p, /한국 거주 클레임으로 인증합니다/)));
  await domClick(p, '[aria-label="거주국 선택"] button', /^KR$/); await wait(300);
  ok('KR 복귀 → "한국 거주 클레임으로 인증합니다"', await has(p, /한국 거주 클레임으로 인증합니다/));
});
section('10 DID 인증');
await run('모바일신분증 인증', async () => {
  await domClick(p, 'button', /모바일신분증으로 인증/);
  const s = await until(p, async () => { const x = await session(p); return x && x.didVerified ? x : null; }, 15000, 700);
  ok('세션 didVerified=true · countryCode=KR', !!s && s.countryCode === 'KR', JSON.stringify(s));
  const where = await until(p, async () => { const w = await path(p); return w.startsWith('/dashboard') || (await domCount(p, 'button', /대시보드로 이동/)) > 0 ? w : null; }, 10000);
  ok('인증 후 대시보드로 이동(자동 또는 "대시보드로 이동" 버튼)', !!where, where);
  if (where && !where.startsWith('/dashboard')) { await domClick(p, 'button', /대시보드로 이동/); await wait(2500); }
  ok('대시보드 도착', (await path(p)).startsWith('/dashboard'), await path(p));
  ok('같은 DID 사용자라 지갑 바인딩이 유지된다(BE mock identity)', !!s && (s.walletAddress === null || /^0x[0-9a-fA-F]{40}$/.test(s.walletAddress)), 'wallet=' + (s && s.walletAddress));
});
await run('인증된 상태에서 /login 재진입 → /dashboard', async () => {
  await go(p, '/login', 2000);
  ok('/login → /dashboard', (await path(p)).startsWith('/dashboard'), await path(p));
});
await closePage(p);
