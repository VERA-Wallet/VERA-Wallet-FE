// 40: 지갑 추가 /connect-wallet (add 모드). 실제 등록은 E2E_MUTATE=1 에서만.
const VALID = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'; // 체크섬 유효, 등록되지 않은 주소
const BAD_CHECKSUM = '0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
async function typeAddress(p, v) { await p.evaluate((v) => { const i = document.querySelector('#watch-address'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })); i.focus(); i.blur(); }, v); await wait(500); }
async function nextDisabled(p) { return p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '다음'); return b ? b.disabled : null; }); }
const p = await newPage();
const s = await ensureLogin(p);
if (!s) { ok('로그인', false, '세션 확보 실패'); }
else {
  const adding = !!s.walletAddress;
  section('40 방법 선택');
  await run('렌더', async () => {
    await go(p, '/connect-wallet', 2500);
    ok('data-surface=wallet-connect + 탭 숨김', (await count(p, '[data-surface=wallet-connect]')) === 1 && (await count(p, '[data-testid=app-nav]')) === 0);
    ok((adding ? '추가' : '온보딩') + ' 모드 헤더', adding ? await has(p, /지갑 추가 1\/3/) && await has(p, /지갑을 하나 더 등록하면/) : await has(p, /지갑을 어떻게/));
    ok('진행 단계(aria-label="... 진행 단계") 3칸', (await count(p, 'ol[aria-label$="진행 단계"] li')) === 3);
    ok('두 방법 버튼: 주소로 추가(추천) · 브라우저 지갑으로 연결', (await domCount(p, 'button', /^주소로 추가/)) === 1 && (await domCount(p, 'button', /^브라우저 지갑으로 연결/)) === 1);
    ok('거래소 연동은 "곧 지원"(aria-disabled) + 6개 거래소', (await count(p, '[data-surface=exchange-coming-soon][aria-disabled=true]')) === 1 && (await count(p, '[aria-label="지원 예정 거래소"] li')) === 6);
    ok('개인키 안 묻는다는 안내', await has(p, /공개 주소만 사용해요/));
    ok('닫기 → ' + (adding ? '/wallets' : '/dashboard'), (await attr(p, '[aria-label="닫기"]', 'href')) === (adding ? '/wallets' : '/dashboard'), await attr(p, '[aria-label="닫기"]', 'href'));
  });
  section('40 주소 입력');
  await run('?method=address 즉시 주소 단계', async () => {
    await go(p, '/connect-wallet?method=address', 2500);
    ok('"지갑 추가 2/3" + #watch-address', await has(p, /2\/3/) && (await count(p, '#watch-address')) === 1);
    ok('빈 입력: 안내 문구 + 다음 비활성', await has(p, /0x로 시작하는 42자리 EVM 주소예요/) && (await nextDisabled(p)) === true);
    ok('클립보드에서 붙여넣기 버튼', (await domCount(p, 'button', /클립보드에서 붙여넣기/)) === 1);
    ok('뒤로 버튼 → 방법 선택', (await count(p, '[aria-label="뒤로"]')) === 1);
  });
  await run('형식 오류', async () => {
    await typeAddress(p, '0x123');
    ok('"0x로 시작하는 42자리 주소를 입력해 주세요" + 다음 비활성', await has(p, /0x로 시작하는 42자리 주소를 입력해 주세요/) && (await nextDisabled(p)) === true);
  });
  await run('ENS 이름', async () => {
    await typeAddress(p, 'vitalik.eth');
    ok('"ENS 이름은 아직 지원하지 않아요" + 다음 비활성', await has(p, /ENS 이름은 아직 지원하지 않아요/) && (await nextDisabled(p)) === true);
  });
  await run('체크섬 오류', async () => {
    await typeAddress(p, BAD_CHECKSUM);
    ok('"주소의 체크섬이 맞지 않아요" + 다음 비활성', await has(p, /주소의 체크섬이 맞지 않아요/) && (await nextDisabled(p)) === true);
  });
  if (adding) await run('이미 등록된 주소', async () => {
    await typeAddress(p, s.walletAddress);
    ok('"이미 등록된 지갑이에요" + 다음 비활성', await has(p, /이미 등록된 지갑이에요/) && (await nextDisabled(p)) === true);
  });
  await run('유효 주소 → 확인 시트', async () => {
    await typeAddress(p, VALID);
    ok('"EVM 주소를 확인했어요 · 체크섬 일치 · 처음 등록하는 주소" + 다음 활성', await has(p, /EVM 주소를 확인했어요/) && await has(p, /체크섬 일치 · 처음 등록하는 주소/) && (await nextDisabled(p)) === false);
    ok('입력 지우기 버튼 노출', (await count(p, '[aria-label="입력 지우기"]')) === 1);
    await shot(p, 'connect_valid');
    ok('다음 클릭', await domClick(p, 'button', /^다음$/)); await wait(900);
    ok('확인 시트 "이 지갑을 추가할까요?" + "추가하고 거래 불러오기"', (await count(p, '[role=dialog][aria-label="이 지갑을 추가할까요?"]')) === 1 && (await domCount(p, 'button', /추가하고 거래 불러오기/)) === 1);
    ok('시트에 입력한 주소 전체 표시', await has(p, new RegExp(VALID)));
    ok('서명 없음 → "미검증"으로 표시된다는 고지 + "추가하면 바로 거래를 불러오기 시작해요"', await has(p, /미검증/) && await has(p, /추가하면 바로 거래를 불러오기 시작해요/));
    ok('조회 체인 "EVM N곳"', await has(p, /EVM \d+곳/));
    await shot(p, 'connect_confirm');
    if (globalThis.E2E_MUTATE === 1 || globalThis.E2E_MUTATE === '1') {
      await domClick(p, 'button', /추가하고 거래 불러오기/);
      const arrived = await until(p, async () => (/importing=1/.test(await path(p)) ? await path(p) : null), 20000, 600);
      ok('등록 → ' + (adding ? '/wallets' : '/dashboard') + '?importing=1', !!arrived && arrived.startsWith(adding ? '/wallets' : '/dashboard'), arrived);
      ok('불러오기 모달 "거래를 불러오는 중"', !!(await untilText(p, /거래를 불러오는 중/, 8000)));
      await domClick(p, 'button', /백그라운드에서 계속/); await wait(1200);
      ok('백그라운드 → 진행 칩', await has(p, /불러오는 중/));
      const done = await untilText(p, /거래 \d+건을 불러왔어요|새로 불러온 거래가 없어요/, 120000);
      ok('완료 토스트', !!done);
      const s2 = await session(p);
      ok('세션 walletAddress 가 새 주소로 갱신', s2 && s2.walletAddress && s2.walletAddress.toLowerCase() === VALID.toLowerCase(), JSON.stringify(s2));
    } else {
      skip('실제 등록', 'E2E_MUTATE=1 이 아니라 시트를 닫는다');
      await domClick(p, '[aria-label="바텀시트 닫기"]'); await wait(500);
      ok('시트 닫힘, 주소 단계 유지', (await count(p, '[role=dialog]')) === 0 && (await count(p, '#watch-address')) === 1);
    }
  });
  await run('입력 지우기', async () => {
    if ((await count(p, '[aria-label="입력 지우기"]')) === 0) { skip('지우기', '버튼 없음'); return; }
    await domClick(p, '[aria-label="입력 지우기"]'); await wait(400);
    ok('입력 비움 + 다음 비활성', (await p.evaluate(() => document.querySelector('#watch-address').value)) === '' && (await nextDisabled(p)) === true);
  });
  section('40 브라우저 지갑(SIWE)');
  await run('?method=browser', async () => {
    await go(p, '/connect-wallet?method=browser', 2500);
    ok('SIWE 단계 렌더(서명/연결 안내)', await has(p, /서명|연결/) && (await count(p, '[data-surface=wallet-connect]')) === 1);
    ok('지갑 확장 없음 → 오류가 아니라 안내로 처리', !(await has(p, /Error|undefined|TypeError/)));
    await shot(p, 'connect_siwe');
  });
  await run('뒤로/닫기 내비', async () => {
    await go(p, '/connect-wallet?method=address', 2000);
    await domClick(p, '[aria-label="뒤로"]'); await wait(600);
    ok('뒤로 → 방법 선택(1/3)', await has(p, /1\/3|지갑을 어떻게/));
    await domClick(p, '[aria-label="닫기"]');
    ok('닫기 → ' + (adding ? '/wallets' : '/dashboard'), !!(await until(p, async () => ((await path(p)).startsWith(adding ? '/wallets' : '/dashboard') ? true : null), 8000)), await path(p));
  });
}
await closePage(p);
