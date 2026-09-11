// 60: 플랜 /plan
const p = await newPage();
const s = await ensureLogin(p);
if (!(s && s.didVerified)) { skip('60 전체', '인증 세션 없음'); }
else {
  section('60 플랜');
  await run('기본 렌더', async () => {
    await go(p, '/plan', 2500);
    ok('data-surface=plan', (await count(p, '[data-surface=plan]')) === 1);
    ok('헤더 "내보낼 때만 결제하세요"', await has(p, /내보낼 때만 결제하세요/));
    ok('무료·플러스·프로 3개 티어', await has(p, /무료/) && await has(p, /플러스/) && await has(p, /프로/));
    ok('가격 ₩0 · ₩69,000 · ₩159,000 (과세연도당)', await has(p, /₩0/) && await has(p, /₩69,000/) && await has(p, /₩159,000/) && await has(p, /과세연도/));
    ok('한도 100건 · 1,000건 · 10,000건', await has(p, /100건까지/) && await has(p, /1,000건까지/) && await has(p, /10,000건까지/));
    ok('데모 결제 버튼 2개(플러스·프로), 실제 결제 아님 명시', (await count(p, 'button:has-text("데모 결제로 시작")')) === 2 && await has(p, /실제 청구가 발생하지 않습니다/));
    ok('현재 플랜 표시("결제 없이 사용 중" 또는 구독 상태)', await has(p, /결제 없이 사용 중|사용 중/));
    ok('플랜은 계산을 바꾸지 않는다는 안내', await has(p, /플랜은 계산 결과를 바꾸지 않습니다/));
  });
  await run('레이아웃: 448px 껍데기 안에서 카드가 한 열(다열 그리드 없음)', async () => {
    // data-surface=plan 은 헤더 블록에만 붙어 있다. 티어 카드는 main 안의 li 다.
    const xs = await p.evaluate(() => [...document.querySelectorAll('main li p')].filter((e) => /^(무료|플러스|프로)$/.test((e.textContent || '').trim())).map((h) => Math.round(h.getBoundingClientRect().x)));
    ok('티어 제목들의 x 좌표가 모두 같다(세로 쌓임)', xs.length >= 3 && xs.every((x) => x === xs[0]), JSON.stringify(xs));
    const wide = await p.evaluate(() => { const m = document.querySelector('main').getBoundingClientRect(); return [...document.querySelectorAll('main li *')].some((e) => e.getBoundingClientRect().right > m.right + 1); });
    ok('티어 카드 밖으로 삐져나온 요소 없음', !wide);
    await shot(p, 'plan');
  });
  await run('내보내기에서 플랜 보기 → /plan', async () => {
    await go(p, '/export', 3000);
    const link = p.locator('a[href="/plan"]');
    if ((await link.count()) === 0) { skip('플랜 보기 링크', '내보내기에 잠금 배너 없음(이미 구독?)'); return; }
    await link.first().click();
    ok('플랜 보기 클릭 → /plan', !!(await until(p, async () => ((await path(p)).startsWith('/plan') ? true : null), 8000)), await path(p));
  });
}
await closePage(p);
