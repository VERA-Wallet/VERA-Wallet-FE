// 50: 리포트 — 메인(세금 보고서 + 내보내기)과 기능별 하위 4화면. /tax 는 /export 로 리다이렉트된다.
// 핵심 계약: 화면을 나눠도 estimate는 하나다 — 하위 화면에서 바꾼 입력이 메인의 금액·내려받기에 그대로 반영된다.
const p = await newPage();
const s = await ensureLogin(p);
const ready = async () => until(p, async () => ((await count(p, '[data-testid=estimated-charge], [aria-label="계산 요약"]')) >= 1 ? true : null), 40000);
// 하위 화면은 **클라이언트 내비게이션**으로 오간다. goto(전체 로드)는 layout을 새로 만들어 입력 상태를 비운다 — 사용자가 하는 동작이 아니다.
const openSub = async (key) => { await domClick(p, '[data-surface=report-menu] a[data-menu="' + key + '"]'); return until(p, async () => ((await path(p)) === '/export/' + key && (await count(p, 'main[data-surface="report-' + key + '"]')) === 1 ? true : null), 15000); };
const backToMain = async () => { await domClick(p, 'main a[href="/export"]', /리포트/); return until(p, async () => ((await path(p)) === '/export' && (await count(p, '[data-surface=report-menu]')) === 1 ? true : null), 15000); };
if (!(s && s.didVerified)) { skip('50 전체', '인증 세션 없음'); }
else {
  section('50 /tax 리다이렉트');
  await run('/tax → /export', async () => {
    await go(p, '/tax', 3500);
    ok('/tax 로 가면 /export 에 도착한다(북마크·옛 링크 보존)', (await path(p)).startsWith('/export'), await path(p));
    ok('data-surface=report 렌더, 옛 tax-simulator 표면은 없다', (await count(p, '[data-surface=report]')) === 1 && (await count(p, '[data-surface=tax-simulator]')) === 0);
  });

  section('50 메인 — 세금 보고서 + 내보내기');
  await run('메인에는 두 가지만 있다', async () => {
    await go(p, '/export', 3500); await ready(); await wait(1500);
    ok('옮겨 간 섹션이 메인에 없다(판정 그룹·흔들리는 것·판단 필요 항목·계산 조건·국가 선택)', (await count(p, '[aria-label="판정 그룹"], [aria-label="흔들리는 것"], [aria-label="판단 필요 항목"], [aria-label="계산 조건"], [aria-label="국가 선택"]')) === 0);
    ok('세금 보고서: 계산 요약 + 예상 부담', (await count(p, '[aria-label="계산 요약"]')) === 1 && (await count(p, '[data-testid=estimated-charge]')) >= 1);
    ok('내보내기: 내려받기 2종', (await count(p, 'button:has-text("직접 신고용 내려받기")')) === 1 && (await count(p, 'button:has-text("세무사 전달용 내려받기")')) === 1);
    const m = await p.evaluate(() => { const main = document.querySelector('main'); const b = [...document.querySelectorAll('button')].find((b) => /직접 신고용 내려받기/.test(b.textContent)); return { h: Math.round(main.getBoundingClientRect().height), interactive: main.querySelectorAll('button, a[href], input, select, summary').length, dlTop: Math.round(b.getBoundingClientRect().top + scrollY) }; });
    ok('메인 높이 ≤ 2,400px(나누기 전 12,259px)', m.h <= 2400, 'h=' + m.h);
    ok('내려받기 버튼이 1,600px 안에 있다(나누기 전 약 10,000px 아래)', m.dlTop <= 1600, 'dlTop=' + m.dlTop);
    ok('누를 수 있는 요소 ≤ 16개(나누기 전 51개)', m.interactive <= 16, 'interactive=' + m.interactive);
    const o = await shellOverflow(p);
    ok('껍데기(448px) 밖으로 넘치는 요소 없음', o.count === 0, 'count=' + o.count + ' worst=' + o.worst);
    await shot(p, 'report_main');
  });
  await run('메뉴 4줄 — 열지 않아도 볼 필요가 있는지 안다', async () => {
    const rows = await p.evaluate(() => [...document.querySelectorAll('[data-surface=report-menu] a[data-menu]')].map((a) => ({ key: a.dataset.menu, href: a.getAttribute('href'), text: a.innerText.replace(/\s+/g, ' ').trim(), h: Math.round(a.getBoundingClientRect().height) })));
    ok('순서: 계산 근거 → 확인할 것 → 계산 설정 → 다른 나라였다면', rows.map((r) => r.key).join(',') === 'basis,issues,settings,compare' && rows.every((r) => r.href === '/export/' + r.key), JSON.stringify(rows.map((r) => r.key + '→' + r.href)));
    ok('줄마다 상태 한마디가 붙는다', /계산 근거 (양도 [\d,]+건 · 취득 [\d,]+건|아직 계산하지 않았어요)/.test(rows[0].text) && /확인할 것 (흔들리는 지점 [\d,]+ · 판단 필요 [\d,]+|정리할 이벤트 [\d,]+건|확인할 것이 없어요)/.test(rows[1].text) && /계산 설정 (데모 시나리오로 보는 중|직접 입력한 값 \d+개|연말 시가 미입력|내 지갑 이벤트로 계산 중)/.test(rows[2].text) && /다른 나라였다면 (.+ 기준으로 비교 중|\d+개 나라 규칙과 비교|나라 목록을 불러오는 중)/.test(rows[3].text), rows.map((r) => r.text).join(' / '));
    ok('터치 대상 ≥ 44px', rows.every((r) => r.h >= 44), rows.map((r) => r.h).join(','));
  });
  await run('시행 가정이 기본(한국 시행 전 연도)', async () => {
    if ((await count(p, '[data-surface=assume-effective]')) === 0) { skip('시행 가정 기본값', '시행 가정 안내 없음(거주국이 시행 예정 룰셋이 아니거나 시행 후 연도)'); return; }
    ok('첫 렌더가 시행 가정 상태("가정 끄기" 버튼이 보인다)', (await domCount(p, '[data-surface=assume-effective] button', /가정 끄기/)) === 1);
    ok('가정이라는 사실을 말한다(실제 부담이 아님)', await domHas(p, '[data-surface=assume-effective]', /가정/) && await domHas(p, '[data-surface=assume-effective]', /실제 부담이 아닙니다|실제 부담은/));
    const on = await p.evaluate(() => { const e = document.querySelector('[data-testid=estimated-charge]'); return e ? e.textContent.trim() : null; });
    ok('"가정 끄기" 클릭', await domClick(p, '[data-surface=assume-effective] button', /가정 끄기/)); await wait(2500);
    ok('끄면 "시행 가정으로 보기"로 바뀐다', !!(await until(p, async () => ((await domCount(p, '[data-surface=assume-effective] button', /시행 가정으로 보기/)) === 1 ? true : null), 10000)));
    ok('다시 켜기', await domClick(p, '[data-surface=assume-effective] button', /시행 가정으로 보기/)); await wait(2500);
    ok('다시 켜면 같은 금액으로 돌아온다', !!(await until(p, async () => ((await p.evaluate(() => { const e = document.querySelector('[data-testid=estimated-charge]'); return e ? e.textContent.trim() : null; })) === on ? true : null), 15000)), on);
  });
  await run('계산은 무료로 전부 보인다(Koinly식)', async () => {
    ok('금액·신뢰도 잠금 없음([data-locked=amount|confidence] 0개)', (await count(p, '[data-locked=amount]')) === 0 && (await count(p, '[data-locked=confidence]')) === 0);
    ok('"구독 후 공개" 문구·plan-cta 배너 없음', !(await has(p, /구독 후 공개/)) && (await count(p, '[data-surface=plan-cta]')) === 0);
    ok('금지 용어 없음(세액·납부할 세금·신고서)', !(await has(p, /세액|납부할 세금|신고서/)));
  });

  section('50 하위 화면');
  await run('계산 근거 /export/basis', async () => {
    ok('메뉴로 이동', !!(await openSub('basis')));
    ok('h1 "계산 근거" + "← 리포트"', (await domCount(p, 'h1', /^계산 근거$/)) === 1 && (await domCount(p, 'main a[href="/export"]', /← 리포트/)) === 1);
    ok('계산 내역·계산 근거·확정 상태가 펼친 섹션으로 있다', (await count(p, 'section[aria-label="계산 내역"]')) === 1 && (await count(p, 'section[aria-label="계산 근거"]')) === 1 && (await count(p, 'section[aria-label="확정 상태"]')) === 1);
    ok('하단 탭 "리포트"가 활성', (await p.evaluate(() => { const a = document.querySelector('[data-testid=app-nav] a[aria-current=page]'); return a ? a.textContent.trim() : null; })) === '리포트');
    const o = await shellOverflow(p); ok('껍데기 넘침 없음', o.count === 0, 'count=' + o.count + ' worst=' + o.worst);
    ok('메인으로 복귀', !!(await backToMain()));
  });
  await run('확인할 것 /export/issues — 종류별 묶음, 5건씩 접기', async () => {
    ok('메뉴로 이동', !!(await openSub('issues')));
    ok('h1 "확인할 것"', (await domCount(p, 'h1', /^확인할 것$/)) === 1);
    const h0 = await p.evaluate(() => Math.round(document.querySelector('main').getBoundingClientRect().height));
    ok('화면 높이 ≤ 4,500px(이 섹션만 8,716px였다)', h0 <= 4500, 'h=' + h0);
    const more = await p.evaluate(() => [...document.querySelectorAll('[aria-label="흔들리는 것"] button[aria-expanded]')].map((b) => ({ t: b.innerText.trim(), e: b.getAttribute('aria-expanded') })));
    if (more.length === 0) skip('더 보기', '5건을 넘는 묶음이 없다');
    else {
      ok('"나머지 n건 더 보기"(aria-expanded=false)', more.every((m) => /^나머지 [\d,]+건 더 보기$/.test(m.t) && m.e === 'false'), JSON.stringify(more));
      const before = await count(p, '[aria-label="흔들리는 것"] li');
      await domClick(p, '[aria-label="흔들리는 것"] button[aria-expanded=false]'); await wait(700);
      const after = await count(p, '[aria-label="흔들리는 것"] li');
      ok('누르면 펼쳐지고 "접기"가 된다', after > before && (await domCount(p, '[aria-label="흔들리는 것"] button[aria-expanded=true]', /^접기$/)) === 1, before + '→' + after);
      await domClick(p, '[aria-label="흔들리는 것"] button[aria-expanded=true]'); await wait(500);
    }
    const longest = await p.evaluate(() => Math.max(0, ...[...document.querySelectorAll('li span')].map((e) => e.textContent.length)));
    ok('제약 항목의 이벤트 ID는 요약된다(li 안 span ≤ 400자, 회귀)', longest <= 400, 'longest=' + longest);
    if ((await count(p, '[data-surface=review-nudge]')) === 1) ok('확인 필요 넛지 → /transactions?tab=review', (await attr(p, '[data-surface=review-nudge]', 'href')) === '/transactions?tab=review');
    const o = await shellOverflow(p); ok('껍데기 넘침 없음', o.count === 0, 'count=' + o.count + ' worst=' + o.worst);
    await shot(p, 'report_issues');
    ok('메인으로 복귀', !!(await backToMain()));
  });
  await run('계산 설정 /export/settings — 바꾼 입력이 메인에 그대로 온다', async () => {
    if (!s.walletAddress) { skip('소스 전환', '지갑 미연결(DID-only)은 데모 고정'); return; }
    ok('메뉴로 이동', !!(await openSub('settings')));
    ok('h1 "계산 설정" + 계산 조건·추가 입력·연말 시가 입력', (await domCount(p, 'h1', /^계산 설정$/)) === 1 && (await count(p, 'section[aria-label="계산 조건"]')) === 1 && (await count(p, 'section[aria-label="추가 입력"]')) === 1);
    ok('데모 시나리오 선택', await domClick(p, 'section[aria-label="계산 조건"] button', /^데모 시나리오/)); await wait(2000);
    ok('메인으로 복귀', !!(await backToMain())); await wait(2000);
    ok('메인: 데모 중에는 내려받기가 막힌다(지갑 데이터가 아니다)', !!(await until(p, async () => ((await domHas(p, '[data-surface=download-blocked]', /데모 시나리오/)) ? true : null), 10000)));
    ok('메인: 메뉴 상태가 "데모 시나리오로 보는 중"', await domHas(p, '[data-surface=report-menu] a[data-menu=settings]', /데모 시나리오로 보는 중/));
    await openSub('settings');
    ok('내 지갑 이벤트 복귀', await domClick(p, 'section[aria-label="계산 조건"] button', /^내 지갑 이벤트/)); await wait(2000);
    await backToMain(); await wait(2000);
    ok('메인: 차단 사유가 사라진다', !!(await until(p, async () => ((await count(p, '[data-surface=download-blocked]')) === 0 ? true : null), 10000)));
  });
  await run('다른 나라였다면 /export/compare — 비교는 메인에 표시되고 내려받기를 막는다', async () => {
    ok('메뉴로 이동', !!(await openSub('compare')));
    ok('12개 국가 버튼', (await count(p, '[aria-label="국가 선택"] button')) === 12, await count(p, '[aria-label="국가 선택"] button'));
    ok('독일 선택', await domClick(p, '[aria-label="국가 선택"] button', /^독일/)); await wait(2500);
    ok('비교 결과가 이 화면 안에 보인다(compare-charge)', !!(await until(p, async () => ((await count(p, '[data-testid=compare-charge]')) === 1 ? true : null), 15000)));
    ok('메인으로 복귀', !!(await backToMain())); await wait(1500);
    ok('메인: "비교 중: 독일"', !!(await until(p, async () => ((await domHas(p, '[data-surface=comparing-country]', /비교 중: 독일/)) ? true : null), 15000)));
    ok('메인: 비교 중에는 내려받기가 막히고 이유를 말한다', (await count(p, '[data-surface=download-blocked]')) === 1 && await p.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /내려받기$/.test(b.textContent.trim())).every((b) => b.disabled)));
    ok('"거주국으로" 클릭', await domClick(p, '[data-surface=comparing-country] button', /거주국으로/)); await wait(2500);
    ok('돌아오면 비교 표시가 사라진다', !!(await until(p, async () => ((await count(p, '[data-surface=comparing-country]')) === 0 ? true : null), 10000)));
  });
  await run('하위 화면 직접 진입도 가드를 통과한다', async () => {
    for (const key of ['basis', 'issues', 'settings', 'compare']) {
      await go(p, '/export/' + key, 3000);
      ok('/export/' + key + ' 직접 진입 → 그 화면', (await path(p)) === '/export/' + key && (await count(p, 'main[data-surface="report-' + key + '"]')) === 1, await path(p));
    }
  });
}
await closePage(p);
