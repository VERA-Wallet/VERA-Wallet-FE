// 20: 대시보드 /dashboard
const p = await newPage();
const s = await ensureLogin(p);
if (!s) { ok('로그인', false, '세션 확보 실패'); }
else if (!s.walletAddress) {
  section('20 대시보드(DID-only 빈 상태)');
  await run('빈 상태', async () => {
    await go(p, '/dashboard', 2500);
    ok('"데이터 불러오기" CTA → /connect-wallet', (await domCount(p, 'a[href^="/connect-wallet"]', /데이터 불러오기/)) >= 1);
    ok('거래 목록 훅이 붙지 않음(요약 표면 없음)', (await count(p, '[data-surface=dashboard-summary]')) === 0);
  });
} else {
  section('20 대시보드 렌더');
  await run('요약·그래프·신뢰도', async () => {
    await go(p, '/dashboard', 4000);
    ok('data-surface=dashboard-summary', (await count(p, '[data-surface=dashboard-summary]')) === 1);
    ok('헤더 "거래 요약" + 기간 버튼("기간 바꾸기")', await has(p, /거래 요약/) && (await domCount(p, 'button', /기간 바꾸기/)) === 1);
    ok('누적 순유입 그래프(data-surface=dashboard-flow, testid flow-total/flow-line)', (await count(p, '[data-surface=dashboard-flow]')) === 1 && (await count(p, '[data-testid=flow-total]')) === 1 && (await count(p, '[data-testid=flow-line]')) === 1);
    ok('기간 프리셋 5개(1개월·3개월·6개월·1년·전체)', (await domCount(p, 'button', /^(1개월|3개월|6개월|1년|전체)$/)) >= 5);
    ok('계산 신뢰도 블록(aria-label=계산 신뢰도)', (await count(p, '[data-surface=dashboard-confidence]')) === 1);
    ok('예상 손익·계산 대상 이벤트 문구', await has(p, /예상 손익/) && await has(p, /계산 대상 이벤트/));
    ok('금지 용어 없음(세액·납부할 세금·신고서)', !(await has(p, /세액|납부할 세금|신고서/)));
    await shot(p, 'dashboard');
  });
  await run('거래 목록', async () => {
    const rows = await domCount(p, 'button', /^(수신|송금|이동|브릿지|스왑|미분류)/);
    ok('거래 행 ≥ 10(버튼, 방향 라벨로 시작)', rows >= 10, 'rows=' + rows);
    ok('행마다 data-event-id + data-event-label', (await count(p, 'button[data-event-id] [data-event-label]')) >= 10);
    ok('탭 "전체 거래 N" · "확인 필요 N"(role=tablist 거래 필터)', (await count(p, '[role=tablist][aria-label="거래 필터"] [role=tab]')) === 2);
    ok('지갑 필터 select(#dashboard-wallet-filter) 옵션 ≥ 2(전체 + 지갑)', (await count(p, '#dashboard-wallet-filter option')) >= 2);
    ok('연도·체인·판정 필터 그룹 존재', (await count(p, '[aria-label="연도 필터"]')) === 1 && (await count(p, '[aria-label="체인 필터"]')) === 1 && (await count(p, '[aria-label="판정 필터"]')) === 1);
    ok('목록에 판정 도장 배지 없음(상세에서만 말한다)', !(await domHas(p, 'button', /^(수신|송금|이동|브릿지|스왑|미분류).*(취득|양도|비과세|계산 제외)/)));
  });
  section('20 상호작용');
  await run('금액 가리기 토글', async () => {
    // 이전 실행이 남긴 localStorage 상태(가려짐)가 있을 수 있어 현재 라벨에서 출발한다.
    const label = async () => p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((b) => /^금액 (가리기|표시)$/.test(b.textContent.trim())); return b ? b.textContent.trim() : null; });
    const flowHasAmount = async () => /₩[\d,]{4,}/.test(await p.evaluate(() => document.querySelector('[data-surface=dashboard-flow]').textContent));
    if ((await label()) === '금액 표시') { await domClick(p, 'button', /^금액 표시$/); await wait(500); }
    ok('초기: "금액 가리기" + 그래프에 ₩ 금액 보임', (await label()) === '금액 가리기' && await flowHasAmount());
    ok('금액 가리기 클릭', await domClick(p, 'button', /^금액 가리기$/)); await wait(500);
    ok('"금액 표시"로 바뀌고 그래프 블록의 ₩ 금액이 가려진다', (await label()) === '금액 표시' && !(await flowHasAmount()));
    await domClick(p, 'button', /^금액 표시$/); await wait(500);
    ok('다시 표시 → 원복', (await label()) === '금액 가리기' && await flowHasAmount());
  });
  await run('확인 필요 탭', async () => {
    await domClick(p, '[role=tablist][aria-label="거래 필터"] [role=tab]', /확인 필요/); await wait(1500);
    ok('확인 필요 탭 aria-selected', (await domCount(p, '[role=tab][aria-selected=true]', /확인 필요/)) === 1);
    await domClick(p, '[role=tablist][aria-label="거래 필터"] [role=tab]', /전체 거래/); await wait(1000);
  });
  await run('체인 필터', async () => {
    const clicked = await domClick(p, '[aria-label="체인 필터"] button', /^(Optimism|Base|Arbitrum)/); await wait(1500);
    ok('체인 필터 버튼 클릭', clicked);
    const other = await p.evaluate(() => { const pressed = document.querySelector('[aria-label="체인 필터"] button[aria-pressed=true], [aria-label="체인 필터"] button[aria-selected=true]'); return pressed ? pressed.textContent.trim() : null; });
    ok('선택 상태가 표시된다(aria-pressed/selected)', other !== null, other);
    await domClick(p, '[aria-label="체인 필터"] button', /^전체 체인/); await wait(800);
  });
  await run('지갑 필터', async () => {
    const changed = await p.evaluate(() => { const sel = document.querySelector('#dashboard-wallet-filter'); if (!sel || sel.options.length < 2) return null; sel.value = sel.options[1].value; sel.dispatchEvent(new Event('change', { bubbles: true })); return sel.options[1].textContent; });
    await wait(1500);
    ok('두 번째 지갑 선택 → 목록 유지', changed !== null && (await domCount(p, 'button', /^(수신|송금|이동|브릿지|스왑|미분류)/)) >= 1, changed);
    await p.evaluate(() => { const sel = document.querySelector('#dashboard-wallet-filter'); sel.value = sel.options[0].value; sel.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(800);
  });
  await run('거래 상세 바텀시트', async () => {
    ok('첫 거래 행 클릭', await domClick(p, 'button', /^(수신|송금|이동|브릿지|스왑|미분류)/)); await wait(1200);
    ok('role=dialog aria-label="거래 상세" 열림', (await count(p, '[role=dialog][aria-label="거래 상세"]')) === 1);
    ok('상세에 분류 select(#classification)·사유 입력(#reason)', (await count(p, '#classification')) === 1 && (await count(p, '#reason')) === 1);
    ok('금액 덮어쓰기 details(data-surface=value-override)', (await count(p, '[data-surface=value-override]')) === 1);
    ok('탐색기 링크(외부 tx URL)', (await count(p, '[role=dialog] a[href*="scan"]')) >= 1);
    await shot(p, 'dashboard_detail');
    ok('바텀시트 닫기', await domClick(p, '[aria-label="바텀시트 닫기"]')); await wait(600);
    ok('닫힘', (await count(p, '[role=dialog][aria-label="거래 상세"]')) === 0);
  });
  await run('기간 선택', async () => {
    ok('기간 바꾸기 클릭', await domClick(p, 'button', /기간 바꾸기/)); await wait(800);
    ok('기간 선택 패널(data-surface=dashboard-period-picker) + 시작일/종료일 입력', (await count(p, '[data-surface=dashboard-period-picker]')) === 1 && (await count(p, 'input[aria-label="시작일"]')) === 1 && (await count(p, 'input[aria-label="종료일"]')) === 1);
    ok('안내 "목록과 그래프만 이 기간으로 좁힙니다"', await has(p, /목록과 그래프만 이 기간으로 좁힙니다/));
    await p.keyboard.press('Escape').catch(() => null); await wait(400);
    await domClick(p, '[aria-label="바텀시트 닫기"]'); await wait(400);
  });
}
await closePage(p);
