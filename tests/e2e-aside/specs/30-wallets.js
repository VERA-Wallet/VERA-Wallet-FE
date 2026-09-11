// 30: 지갑 /wallets, /wallets/[address]
const p = await newPage();
const s = await ensureLogin(p);
if (!s) { ok('로그인', false, '세션 확보 실패'); }
else {
  section('30 지갑 홈');
  await run('렌더', async () => {
    await go(p, '/wallets', 2500);
    ok('헤더(data-surface=wallets-summary) + "지갑 불러오기" 버튼', (await count(p, '[data-surface=wallets-summary]')) === 1 && (await count(p, '[data-surface=wallets-import]')) === 1);
    ok('전체 평가액 블록(data-surface=wallets-total)', (await count(p, '[data-surface=wallets-total]')) === 1);
    ok('소스 탭(role=tablist 자산 소스): 지갑 · 거래소', (await count(p, '[role=tablist][aria-label="자산 소스"] [role=tab]')) === 2);
    if (!s.walletAddress) { ok('지갑 없음 → 빈 카드(data-surface=wallet-empty)', (await count(p, '[data-surface=wallet-empty]')) === 1); return; }
    ok('회색 그룹 카드(data-surface=wallets-group) 안에 지갑 행(a[data-surface=wallet-row]) ≥ 1', (await count(p, '[data-surface=wallets-group] a[data-surface=wallet-row]')) >= 1);
    ok('행 aria-label "<주소> 포트폴리오 열기", href=/wallets/<소문자 주소>', await p.evaluate(() => [...document.querySelectorAll('a[data-surface=wallet-row]')].every((a) => /^0x[0-9a-fA-F]{40} 포트폴리오 열기$/.test(a.getAttribute('aria-label') || '') && a.getAttribute('href') === '/wallets/' + a.getAttribute('aria-label').slice(0, 42).toLowerCase())));
    ok('세션 지갑이 목록에 있다', (await count(p, 'a[href="/wallets/' + s.walletAddress.toLowerCase() + '"]')) === 1);
    ok('"지갑 추가하기" 버튼(data-surface=wallets-add)', (await count(p, '[data-surface=wallets-add]')) === 1);
    ok('파란 CTA 없음(토스식: 회색 카드·텍스트 버튼)', !(await p.evaluate(() => [...document.querySelectorAll('[data-surface=wallets-group] button, [data-surface=wallets-add]')].some((b) => /bg-primary-500/.test(b.className)))));
  });
  await run('총액 로딩 완료(회귀 임계 45s)', async () => {
    if (!s.walletAddress) { skip('총액', '지갑 없음'); return; }
    const t0 = Date.now();
    const done = await until(p, async () => ((await attr(p, '[data-surface=wallets-total]', 'aria-busy')) !== 'true' ? true : null), 45000, 800);
    const ms = Date.now() - t0;
    ok('aria-busy 해제 + 금액 표시', !!done && await has(p, /전체 평가액[\s\S]{0,40}[₩$]/), 'ms=' + ms);
    ok('오류 문구 없음(wallets-total-error/stale)', (await count(p, '[data-surface=wallets-total-error]')) === 0 && (await count(p, '[data-surface=wallets-total-stale]')) === 0);
    await shot(p, 'wallets_home');
  });
  await run('지갑 불러오기 시트', async () => {
    ok('지갑 불러오기 클릭', await domClick(p, '[data-surface=wallets-import]')); await wait(800);
    ok('시트(data-surface=wallets-import-sheet) 열림', (await count(p, '[data-surface=wallets-import-sheet]')) === 1);
    ok('주소로 추가 → /connect-wallet?method=address', (await count(p, '[data-surface=wallets-import-sheet] a[href="/connect-wallet?method=address"]')) === 1);
    ok('브라우저 지갑 → /connect-wallet?method=browser', (await count(p, '[data-surface=wallets-import-sheet] a[href="/connect-wallet?method=browser"]')) === 1);
    await domClick(p, '[aria-label="바텀시트 닫기"]'); await wait(500);
    ok('닫힘', (await count(p, '[data-surface=wallets-import-sheet]')) === 0);
  });
  await run('거래소 탭', async () => {
    await domClick(p, '[role=tablist][aria-label="자산 소스"] [role=tab]', /거래소/); await wait(600);
    ok('거래소 탭 → 준비 중 카드(data-surface=exchange-coming-soon)', (await count(p, '[data-surface=exchange-coming-soon]')) === 1);
    await domClick(p, '[role=tablist][aria-label="자산 소스"] [role=tab]', /^지갑/); await wait(400);
  });
  section('30 지갑 상세');
  if (!s.walletAddress) { skip('상세', '지갑 없음'); }
  else await run('상세 진입·포트폴리오', async () => {
    ok('지갑 행 클릭', await domClick(p, 'a[href="/wallets/' + s.walletAddress.toLowerCase() + '"]'));
    ok('→ /wallets/<addr>', !!(await until(p, async () => ((await path(p)).startsWith('/wallets/0x') ? true : null), 8000)), await path(p));
    const loaded = await until(p, async () => ((await count(p, '[data-surface=wallet-portfolio-header]')) === 1 ? true : null), 45000, 800);
    ok('헤더(data-surface=wallet-portfolio-header) 로드(로딩 표면 → 본문)', !!loaded);
    ok('로딩/오류 표면이 남아 있지 않음', (await count(p, '[data-surface=wallet-portfolio-loading]')) === 0 && (await count(p, '[data-surface=wallet-portfolio-error]')) === 0);
    ok('총액(data-surface=wallet-total) + 주소 복사 버튼 + 지갑 목록으로', (await count(p, '[data-surface=wallet-total]')) === 1 && (await count(p, '[aria-label="주소 복사"]')) === 1 && (await count(p, '[aria-label="지갑 목록으로"]')) === 1);
    ok('자산 종류 탭(role=tablist)', (await count(p, '[role=tablist][aria-label="자산 종류"] [role=tab]')) >= 2);
    ok('등록 방식 배지 없음(전면 제거 규칙)', !(await has(p, /watch_only|주소로 등록|서명 등록/)));
    const rows = await count(p, '[data-surface=holding-row], [data-surface=holding-group]');
    ok('보유 자산 행 ≥ 1', rows >= 1, 'rows=' + rows);
    ok('모든 행에 펼침 버튼(aria-expanded)', (await count(p, '[data-surface=holding-row] button[aria-expanded], [data-surface=holding-group] button[aria-expanded]')) === rows);
    ok('"원가 확인" 문구 없음', !(await has(p, /원가 확인/)));
    ok('로고: 각 행에 img 또는 심볼 마크', (await count(p, '[data-surface=holding-row] img, [data-surface=holding-group] img, [data-surface=holding-row] [aria-label], [data-surface=holding-group] [aria-label]')) >= rows);
    await shot(p, 'wallet_detail');
  });
  if (s.walletAddress) await run('체인 합산 행 펼침', async () => {
    const g = await count(p, '[data-surface=holding-group]');
    if (g === 0) { skip('그룹 행', '여러 체인에 걸친 정식 자산 없음'); return; }
    const chains = await attr(p, '[data-surface=holding-group]', 'data-chains');
    ok('그룹 행 data-chains 에 체인 2개 이상', (chains || '').split(',').length >= 2, chains);
    ok('펼침 클릭', await domClick(p, '[data-surface=holding-group] button[aria-expanded]')); await wait(600);
    ok('aria-expanded=true + 멤버 목록(holding-group-members)', (await count(p, '[data-surface=holding-group] button[aria-expanded=true]')) >= 1 && (await count(p, '[data-surface=holding-group-member]')) >= 2);
    await shot(p, 'wallet_group_expanded');
  });
  if (s.walletAddress) await run('뒤로', async () => {
    await domClick(p, '[aria-label="지갑 목록으로"]');
    ok('지갑 목록으로 → /wallets', !!(await until(p, async () => ((await path(p)) === '/wallets' ? true : null), 8000)), await path(p));
  });
}
await closePage(p);
