// 70: 리포트 /export — 헤더·귀속연도·내려받기·플랜. 계산 쪽(시행 가정·근거·나라 비교)은 50 이 맡는다.
const p = await newPage();
const s = await ensureLogin(p);
if (!(s && s.didVerified)) { skip('70 전체', '인증 세션 없음'); }
else if (!s.walletAddress) {
  section('70 리포트(DID-only 데모)');
  await run('지갑 없이도 계산은 데모로 보인다', async () => {
    await go(p, '/export', 3500);
    ok('data-surface=report', (await count(p, '[data-surface=report]')) === 1);
    ok('데모로 보는 중이라는 사실 + 연결하기 → /connect-wallet', await has(p, /데모 시나리오로 보는 중입니다/) && (await count(p, 'a[href^="/connect-wallet"]')) >= 1);
    ok('내려받기는 막힌다', (await count(p, '[data-surface=download-blocked]')) === 1);
  });
} else {
  section('70 리포트(지갑 연결됨)');
  await run('기본 렌더', async () => {
    await go(p, '/export', 3500);
    await until(p, async () => ((await count(p, 'button:has-text("직접 신고용 내려받기")')) === 1 ? true : null), 30000);
    ok('헤더 h1 "리포트"(data-surface=report)', (await count(p, '[data-surface=report]')) === 1 && (await domCount(p, 'h1', /^리포트$/)) === 1);
    ok('귀속연도 선택 버튼("NNNN년 귀속")', (await count(p, 'button:has-text("년 귀속")')) >= 1);
    ok('두 가지 내려받기(직접 신고용·세무사 전달용)', (await count(p, 'button:has-text("직접 신고용 내려받기")')) === 1 && (await count(p, 'button:has-text("세무사 전달용 내려받기")')) === 1);
    ok('건수 안내("건수는 계산 대상 이벤트 기준")', await has(p, /건수는 계산 대상 이벤트 기준/));
    ok('금지 용어 없음(세액·납부할 세금·신고서)', !(await has(p, /세액|납부할 세금|신고서/)));
    ok('하단 탭 "리포트"가 활성', (await p.evaluate(() => { const a = document.querySelector('[data-testid=app-nav] a[aria-current=page]'); return a ? a.textContent.trim() : null; })) === '리포트');
    await shot(p, 'report_default');
  });
  await run('잠기는 것은 내려받기뿐이다', async () => {
    const planStatus = await count(p, '[data-surface=plan-status]');
    const lockedButtons = await count(p, 'button[data-locked=download]');
    ok('금액 잠금 0개', (await count(p, '[data-locked=amount]')) === 0);
    if (planStatus === 0) {
      ok('미구독: 내려받기 버튼 2개가 잠김(data-locked=download, disabled)', lockedButtons === 2 && await p.evaluate(() => [...document.querySelectorAll('button[data-locked=download]')].every((b) => b.disabled)), 'locked=' + lockedButtons);
      ok('"계산은 무료예요. 파일로 내려받을 때만 결제해요."', await has(p, /계산은 무료예요\. 파일로 내려받을 때만 결제해요/));
      ok('플랜 줄 → /plan("무료 플랜 100건까지 · 현재 N건")', await has(p, /무료 플랜 100건까지 · 현재 [\d,]+건/) && (await count(p, 'a[href="/plan"]')) >= 1);
      ok('과세연도별 결제는 리포트에 없다(플랜 화면으로 이사)', (await count(p, '[data-surface=plan-payments]')) === 0);
    } else {
      ok('구독 중: 구독 상태 카드 + 사용량 게이지(role=progressbar)', (await count(p, '[data-surface=plan-status] [role=progressbar]')) === 1);
      ok('구독 중에도 과세연도별 결제는 리포트에 없다(플랜 화면으로 이사)', (await count(p, '[data-surface=plan-payments]')) === 0);
      await go(p, '/plan', 2500);
      ok('구독 중: /plan 에 과세연도별 결제 1행', (await count(p, '[data-surface=plan-payments]')) === 1);
      await go(p, '/export', 3500);
      ok('구독 중: 한도 안이면 내려받기가 열린다', lockedButtons === 0 || await has(p, /상위 플랜이 필요합니다/), 'locked=' + lockedButtons);
    }
  });
  await run('귀속연도 전환', async () => {
    const label = async () => p.evaluate(() => ([...document.querySelectorAll('button')].find((b) => /년 귀속/.test(b.textContent)) || {}).textContent);
    const before = await label();
    await p.locator('button:has-text("년 귀속")').first().click(); await wait(800);
    ok('연도 선택 시트가 열린다', (await count(p, '[role=dialog]')) >= 1);
    const other = await p.evaluate((before) => { const b = [...document.querySelectorAll('[role=dialog] button')].find((b) => /^\d{4}년 귀속/.test(b.textContent.trim()) && !before.includes(b.textContent.trim().slice(0, 4))); if (!b) return null; const t = b.textContent.trim().slice(0, 4); b.click(); return t; }, before || '');
    if (other === null) { skip('다른 연도 선택', '선택지 없음'); await domClick(p, '[aria-label="바텀시트 닫기"]'); return; }
    ok('다른 연도(' + other + ') 선택 → 헤더 칩이 바뀐다', !!(await until(p, async () => (((await label()) || '').includes(other) ? true : null), 10000)), await label());
    await p.locator('button:has-text("년 귀속")').first().click(); await wait(800);
    await p.evaluate((y) => { const b = [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim().startsWith(y)); if (b) b.click(); }, (before || '').slice(0, 4)); await wait(1500);
    ok('원래 연도로 복귀', ((await label()) || '') === before, await label());
  });
  await run('앵커링 증명은 계산 근거 화면에 있다', async () => {
    ok('메인에는 없다', (await count(p, '[data-surface=anchor-proof]')) === 0);
    await go(p, '/export/basis', 3500);
    await until(p, async () => ((await count(p, 'section[aria-label="계산 내역"]')) === 1 ? true : null), 30000);
    if ((await count(p, '[data-surface=anchor-proof]')) === 0) { skip('앵커링 증명', '증명 없음(이 계정에 앵커링 기록이 없다)'); return; }
    ok('탐색기 링크', (await domCount(p, 'main a', /탐색기에서 보기/)) >= 1);
  });
}
await closePage(p);
