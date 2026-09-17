// 65: 설정 /settings — 탭이 아니라 요약 헤더 톱니로만 들어온다. 1차 범위는 이미 있는 것뿐(플랜·금액 가리기·스팸·로그아웃).
const p = await newPage();
const s = await ensureLogin(p);
if (!s) { ok('로그인', false, '세션 확보 실패'); }
else {
  section('65 설정');
  await run('요약 톱니 → 설정', async () => {
    await go(p, '/dashboard', 3500);
    if ((await count(p, '[data-surface=dashboard-summary] a[aria-label="설정"]')) === 0) { skip('톱니 진입', 'DID-only 빈 상태에는 요약 헤더가 없다'); await go(p, '/settings', 2500); return; }
    await p.locator('[data-surface=dashboard-summary] a[aria-label="설정"]').click();
    ok('톱니 클릭 → /settings', !!(await until(p, async () => ((await path(p)) === '/settings' ? true : null), 8000)), await path(p));
  });
  await run('항목', async () => {
    ok('data-surface=settings + h1 "설정" + "← 요약"→/dashboard', (await count(p, '[data-surface=settings]')) === 1 && (await domCount(p, 'h1', /^설정$/)) === 1 && (await domCount(p, '[data-surface=settings] a[href="/dashboard"]', /요약/)) === 1);
    ok('플랜 행 → /plan', (await count(p, '[data-surface=settings] a[href="/plan"]')) === 1);
    ok('스팸 거래 보기 → /transactions?spam=1(라벨이 말한 목록에 바로 도착)', (await domCount(p, '[data-surface=settings] a[href="/transactions?spam=1"]', /스팸 거래 보기/)) === 1);
    ok('로그아웃 버튼', (await domCount(p, '[data-surface=settings] button', /로그아웃/)) === 1);
    ok('세금 계산 항목 없음(거주국·기준 통화·원가 계산법은 1차 범위 밖)', !(await has(p, /거주국|기준 통화|원가 계산법/)));
    ok('행 높이 ≥ 44px', await p.evaluate(() => [...document.querySelectorAll('[data-surface=settings] section a, [data-surface=settings] section button')].every((e) => e.getBoundingClientRect().height >= 43 || e.getAttribute('role') === 'switch')));
    ok('가로 스크롤 없음', await noHorizontalOverflow(p));
    await shot(p, 'settings');
  });
  await run('금액 가리기로 시작 ↔ 요약 화면 공유', async () => {
    const sw = '[aria-label="금액 가리기로 시작"]';
    const state = async () => attr(p, sw, 'aria-checked');
    const initial = await state();
    ok('스위치 존재(role=switch)', initial === 'true' || initial === 'false', initial);
    await domClick(p, sw); await wait(500);
    const flipped = await state();
    ok('클릭 → aria-checked 반전', flipped !== initial, initial + '→' + flipped);
    if (s.walletAddress) {
      await go(p, '/dashboard', 3500);
      ok('요약의 토글 라벨이 같은 값을 말한다', (await domCount(p, 'button', flipped === 'true' ? /^금액 표시$/ : /^금액 가리기$/)) === 1);
      await go(p, '/settings', 2500);
    }
    await domClick(p, sw); await wait(500);
    ok('원복', (await state()) === initial);
  });
  // 로그아웃은 세션을 끊으므로 맨 마지막. 뒤 스펙은 ensureLogin 이 다시 로그인한다(같은 DID → 같은 사용자).
  await run('로그아웃', async () => {
    await domClick(p, '[data-surface=settings] button', /로그아웃/);
    ok('로그아웃 → /login', !!(await until(p, async () => ((await path(p)).startsWith('/login') ? true : null), 10000)), await path(p));
    const after = await session(p);
    ok('세션이 끊겼다', !(after && after.didVerified));
    const back = await ensureLogin(p);
    ok('재로그인 후 지갑 바인딩 유지', !!back && back.walletAddress === s.walletAddress, back ? String(back.walletAddress) : 'null');
  });
}
await closePage(p);
