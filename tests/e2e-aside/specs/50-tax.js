// 50: 리포트의 계산(옛 세금 탭 /tax) — /tax 는 /export 로 리다이렉트되고, 세금 탭에 있던 계산·근거·나라 비교는 리포트가 말한다.
const p = await newPage();
const s = await ensureLogin(p);
const REPORT = '[data-surface=report]';
const ready = async () => until(p, async () => ((await count(p, '[data-testid=estimated-charge], [aria-label="계산 요약"]')) >= 1 ? true : null), 40000);
if (!(s && s.didVerified)) { skip('50 전체', '인증 세션 없음'); }
else {
  section('50 /tax 리다이렉트');
  await run('/tax → /export', async () => {
    await go(p, '/tax', 3500);
    ok('/tax 로 가면 /export 에 도착한다(북마크·옛 링크 보존)', (await path(p)).startsWith('/export'), await path(p));
    ok('data-surface=report 렌더, 옛 tax-simulator 표면은 없다', (await count(p, REPORT)) === 1 && (await count(p, '[data-surface=tax-simulator]')) === 0);
  });

  section('50 계산');
  await run('시행 가정이 기본(한국 시행 전 연도)', async () => {
    await go(p, '/export', 3500); await ready();
    if ((await count(p, '[data-surface=assume-effective]')) === 0) { skip('시행 가정 기본값', '시행 가정 안내 없음(거주국이 시행 예정 룰셋이 아니거나 시행 후 연도)'); return; }
    ok('첫 렌더가 시행 가정 상태("가정 끄기" 버튼이 보인다)', (await domCount(p, '[data-surface=assume-effective] button', /가정 끄기/)) === 1);
    ok('가정이라는 사실을 말한다(실제 부담이 아님)', await domHas(p, '[data-surface=assume-effective]', /가정/) && await domHas(p, '[data-surface=assume-effective]', /실제 부담이 아닙니다|실제 부담은/));
    const on = await p.evaluate(() => { const e = document.querySelector('[data-testid=estimated-charge]'); return e ? e.textContent.trim() : null; });
    ok('가정 켜짐: 예상 부담 금액이 보인다', on !== null && /[\d]/.test(on), on);
    ok('"가정 끄기" 클릭', await domClick(p, '[data-surface=assume-effective] button', /가정 끄기/)); await wait(2500);
    ok('끄면 "시행 가정으로 보기"로 바뀐다', !!(await until(p, async () => ((await domCount(p, '[data-surface=assume-effective] button', /시행 가정으로 보기/)) === 1 ? true : null), 10000)));
    ok('다시 켜기', await domClick(p, '[data-surface=assume-effective] button', /시행 가정으로 보기/)); await wait(2500);
    ok('다시 켜면 같은 금액으로 돌아온다', !!(await until(p, async () => ((await p.evaluate(() => { const e = document.querySelector('[data-testid=estimated-charge]'); return e ? e.textContent.trim() : null; })) === on ? true : null), 15000)), on);
    await shot(p, 'report_assumed');
  });
  await run('계산은 무료로 전부 보인다(Koinly식)', async () => {
    ok('금액·신뢰도 잠금 없음([data-locked=amount|confidence] 0개)', (await count(p, '[data-locked=amount]')) === 0 && (await count(p, '[data-locked=confidence]')) === 0);
    ok('"구독 후 공개" 문구·plan-cta 배너 없음', !(await has(p, /구독 후 공개/)) && (await count(p, '[data-surface=plan-cta]')) === 0);
    if ((await count(p, '[data-surface=report-preview]')) === 1) {
      const amounts = await p.evaluate(() => [...document.querySelectorAll('[data-surface=report-preview]')][0].closest('div[class*=card], section, article, div').parentElement.querySelectorAll('dl dd').length);
      ok('기타소득 계산 줄에 금액이 찍힌다(dd ≥ 8)', amounts >= 8, 'dd=' + amounts);
    } else skip('기타소득 계산 카드', '이 연도에 셀 것이 없거나 과세 대상 아님(카드 미렌더 — 설계)');
    ok('금지 용어 없음(세액·납부할 세금·신고서)', !(await has(p, /세액|납부할 세금|신고서/)));
  });
  await run('근거 섹션이 리포트로 이사했다', async () => {
    ok('"왜 이 금액인가"(aria-label=판정 그룹)', (await count(p, '[aria-label="판정 그룹"]')) === 1 || !(await count(p, '[data-testid=estimated-charge]')));
    ok('접힌 계산 조건·계산 근거(details)', (await count(p, 'details[aria-label="계산 조건"]')) === 1 && (await count(p, 'details[aria-label="계산 근거"]')) === 1);
    const longest = await p.evaluate(() => Math.max(0, ...[...document.querySelectorAll('li span')].map((e) => e.textContent.length)));
    ok('제약 항목의 이벤트 ID는 요약된다(li 안 span ≤ 400자, 회귀)', longest <= 400, 'longest=' + longest);
    const o = await shellOverflow(p);
    ok('껍데기(448px) 밖으로 넘치는 요소 없음', o.count === 0, 'count=' + o.count + ' worst=' + o.worst);
  });

  section('50 다른 나라였다면');
  await run('나라 비교는 맨 아래 접힘', async () => {
    ok('details "다른 나라였다면"이 접힌 채로 있다', (await p.evaluate(() => { const d = [...document.querySelectorAll('details')].find((d) => /다른 나라였다면/.test(d.querySelector('summary').textContent)); return d ? d.open : null; })) === false);
    ok('나라 칩이 화면 맨 위에 없다(국가 선택 그룹은 접힘 안)', await p.evaluate(() => { const g = document.querySelector('[aria-label="국가 선택"]'); return !!g && !!g.closest('details'); }));
    await p.evaluate(() => { const d = [...document.querySelectorAll('details')].find((d) => /다른 나라였다면/.test(d.querySelector('summary').textContent)); d.open = true; d.scrollIntoView({ block: 'center' }); }); await wait(600);
    ok('12개 국가 버튼', (await count(p, '[aria-label="국가 선택"] button')) === 12, await count(p, '[aria-label="국가 선택"] button'));
    ok('독일 선택', await domClick(p, '[aria-label="국가 선택"] button', /^독일/)); await wait(2500);
    ok('"비교 중: 독일" 사실이 금액 옆에 붙는다', !!(await until(p, async () => ((await domHas(p, '[data-surface=comparing-country]', /비교 중: 독일/)) ? true : null), 15000)));
    ok('비교 중에는 내려받기가 막히고 이유를 말한다(download-blocked)', (await count(p, '[data-surface=download-blocked]')) === 1 && await p.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /내려받기$/.test(b.textContent.trim())).every((b) => b.disabled)));
    ok('"거주국으로" 클릭', await domClick(p, '[data-surface=comparing-country] button', /거주국으로/)); await wait(2500);
    ok('돌아오면 비교 표시가 사라진다', !!(await until(p, async () => ((await count(p, '[data-surface=comparing-country]')) === 0 ? true : null), 10000)));
  });
  await run('데모/내 지갑 소스 전환', async () => {
    if (!s.walletAddress) { skip('소스 전환', '지갑 미연결(DID-only)은 데모 고정'); return; }
    await p.evaluate(() => { const d = document.querySelector('details[aria-label="계산 조건"]'); d.open = true; d.scrollIntoView({ block: 'center' }); }); await wait(500);
    ok('데모 시나리오 선택', await domClick(p, 'details[aria-label="계산 조건"] button', /^데모 시나리오/)); await wait(2500);
    ok('데모 중에는 내려받기가 막힌다(지갑 데이터가 아니다)', !!(await until(p, async () => ((await domHas(p, '[data-surface=download-blocked]', /데모 시나리오/)) ? true : null), 10000)));
    ok('내 지갑 이벤트 복귀', await domClick(p, 'details[aria-label="계산 조건"] button', /^내 지갑 이벤트/)); await wait(2500);
    ok('복귀하면 차단 사유가 사라진다', !!(await until(p, async () => ((await count(p, '[data-surface=download-blocked]')) === 0 ? true : null), 10000)));
  });
}
await closePage(p);
