// 50: 룰셋 비교 /tax
const p = await newPage();
const s = await ensureLogin(p);
if (!(s && s.didVerified)) { skip('50 전체', '인증 세션 없음'); }
else {
  section('50 룰셋 비교 진입');
  await run('기본 렌더', async () => {
    await go(p, '/tax', 3500);
    ok('data-surface=tax-simulator', (await count(p, '[data-surface=tax-simulator]')) === 1);
    ok('헤더 "올해 세금" + 보조 문구(계산 보조용·확정 판단 아님)', await has(p, /올해 세금/) && await has(p, /계산 보조용이며 확정 판단이 아닙니다/));
    ok('국가 선택 그룹(aria-label=국가 선택)에 12개 국가 버튼', (await count(p, '[aria-label="국가 선택"] button')) === 12, await count(p, '[aria-label="국가 선택"] button'));
    ok('거주국(세션 countryCode=' + s.countryCode + ')이 기본 선택', await has(p, new RegExp((s.countryCode === 'KR' ? '한국' : s.countryCode) + ' · \\d{4}')));
    ok('연도 버튼 2023~2027(시행)', await domHas(p, 'button', /^2023$/) && await domHas(p, 'button', /^2027/));
    ok('금지 용어 없음(세액·납부할 세금·신고서)', !(await has(p, /세액|납부할 세금|신고서/)));
    await shot(p, 'tax_default');
  });
  section('50 상호작용');
  await run('연도 전환', async () => {
    ok('2024 버튼 클릭', await domClick(p, 'button', /^2024$/)); await wait(1500);
    ok('2024 선택 → 과세기간 2024-01-01 ~ 2024-12-31', await has(p, /과세기간 2024-01-01 ~ 2024-12-31/));
  });
  await run('국가 전환', async () => {
    await p.locator('[aria-label="국가 선택"] button:has-text("독일")').first().click(); await wait(1500);
    ok('독일 선택 → "독일 · " 헤더', await has(p, /독일 · \d{4}/));
    await p.locator('[aria-label="국가 선택"] button:has-text("한국")').first().click(); await wait(1500);
    ok('한국 복귀', await has(p, /한국 · \d{4}/));
  });
  await run('시행 가정 토글(한국 2027 시행 전)', async () => {
    await go(p, '/tax', 3000);
    const btn = p.locator('button:has-text("시행 가정으로 보기")');
    if ((await btn.count()) === 0) { skip('시행 가정 토글', '버튼 없음(해당 연도가 시행 후)'); return; }
    await btn.first().click(); await wait(1500);
    ok('토글 후 "과세 대상 아님" 문구가 사라지거나 가정 계산으로 바뀜', !(await has(p, /2026년 발생분은 시행일 전이라 과세 대상이 아닙니다/)) || await has(p, /가정/));
  });
  await run('데모/내 지갑 소스 전환', async () => {
    await go(p, '/tax', 3000);
    const demo = p.locator('button:has-text("데모 시나리오")');
    if ((await demo.count()) === 0) { skip('소스 전환', '데모 버튼 없음'); return; }
    await domClick(p, 'button', /^데모 시나리오/); await wait(1500);
    ok('데모 시나리오로 전환해도 시뮬레이터 유지', (await count(p, '[data-surface=tax-simulator]')) === 1);
    await domClick(p, 'button', /^내 지갑 이벤트/); await wait(1500);
    ok('내 지갑 이벤트 복귀', (await count(p, '[data-surface=tax-simulator]')) === 1);
  });
  await run('제약 항목의 이벤트 ID는 요약된다(회귀)', async () => {
    await go(p, '/tax', 3000);
    const longest = await p.evaluate(() => Math.max(0, ...[...document.querySelectorAll('li span')].map((e) => e.textContent.length)));
    ok('li 안 어떤 span 도 400자 이하', longest <= 400, 'longest=' + longest);
    ok('확인하러 가기/거래 탭으로 링크 → /dashboard', (await domCount(p, 'a[href^="/dashboard"]', /확인하러 가기|거래 탭으로/)) >= 1);
  });
}
await closePage(p);
