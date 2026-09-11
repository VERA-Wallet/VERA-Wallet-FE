// 70: 내보내기 /export
const p = await newPage();
const s = await ensureLogin(p);
if (!(s && s.didVerified)) { skip('70 전체', '인증 세션 없음'); }
else if (!s.walletAddress) {
  section('70 내보내기(DID-only)');
  await run('빈 상태', async () => {
    await go(p, '/export', 2500);
    ok('"내보낼 거래가 아직 없습니다"', await has(p, /내보낼 거래가 아직 없습니다/));
    ok('지갑 연결하기 → /connect-wallet', (await count(p, 'a[href="/connect-wallet"]')) === 1);
  });
} else {
  section('70 내보내기(지갑 연결됨)');
  await run('기본 렌더', async () => {
    await go(p, '/export', 3500);
    ok('헤더 "내보내기 · 신고 근거자료"', await has(p, /내보내기 · 신고 근거자료/));
    ok('귀속연도 선택 버튼("NNNN년 귀속")', (await count(p, 'button:has-text("년 귀속")')) >= 1);
    ok('report-preview 표면', (await count(p, '[data-surface=report-preview]')) === 1);
    ok('두 가지 내려받기(직접 신고용·세무사 전달용)', (await count(p, 'button:has-text("직접 신고용 내려받기")')) === 1 && (await count(p, 'button:has-text("세무사 전달용 내려받기")')) === 1);
    ok('건수 안내("건수는 계산 대상 이벤트 기준")', await has(p, /건수는 계산 대상 이벤트 기준/));
    ok('금지 용어 없음(세액·납부할 세금·신고서)', !(await has(p, /세액|납부할 세금|신고서/)));
    await shot(p, 'export_default');
  });
  await run('플랜 잠금 상태 일관성', async () => {
    const locked = await has(p, /구독 후 공개/);
    const cta = await count(p, '[data-surface=plan-cta]');
    ok('잠금이면 plan-cta 배너 + "플랜 보기" 링크, 아니면 둘 다 없음', locked ? cta === 1 && (await count(p, 'a[href="/plan"]')) >= 1 : cta === 0, 'locked=' + locked + ' cta=' + cta);
    if (locked) {
      ok('잠금 상태에서 금액은 가려진다(aria-label=구독 후 공개)', (await count(p, '[aria-label="구독 후 공개"]')) >= 1);
      ok('한도 문구("무료 플랜 100건까지 · 현재 N건")', await has(p, /무료 플랜 100건까지 · 현재 \d+건/));
    }
  });
  await run('귀속연도 전환', async () => {
    const before = await p.evaluate(() => (document.querySelector('button') && [...document.querySelectorAll('button')].find((b) => /년 귀속/.test(b.textContent)) || {}).textContent);
    await p.locator('button:has-text("년 귀속")').first().click(); await wait(800);
    const opened = (await count(p, '[role=dialog], [role=listbox], [role=menu]')) > 0 || (await p.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /^\d{4}년/.test(b.textContent.trim())).length)) > 1;
    ok('연도 선택 UI가 열린다', opened);
    const other = p.locator('button').filter({ hasText: /^(2023|2024|2025)년/ });
    if ((await other.count()) > 0) { await other.first().click(); await wait(2500); ok('다른 연도 선택 → 헤더 연도 변경', (await p.evaluate(() => ([...document.querySelectorAll('button')].find((b) => /년 귀속/.test(b.textContent)) || {}).textContent)) !== before); }
    else skip('다른 연도 선택', '선택지 없음');
  });
  await run('시행 가정 토글', async () => {
    await go(p, '/export', 3000);
    const t = p.locator('[data-surface=assume-effective] button');
    if ((await t.count()) === 0) { skip('시행 가정', '배너 없음'); return; }
    await t.first().click(); await wait(2000);
    ok('토글 후 화면 유지·report-preview 존재', (await count(p, '[data-surface=report-preview]')) === 1);
  });
}
await closePage(p);
