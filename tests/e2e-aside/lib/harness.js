// aside repl 공통 하네스. run.sh가 이 파일 + 스펙 + footer.js 를 이어 붙여 한 번의 `aside repl`로 보낸다.
// 규칙(메모리·경험에서 온 함정 회피):
//  - 최상위는 반드시 `await (async () => {...})()` 로 감싼다(footer.js가 담당). repl은 떠 있는 프로미스를 기다리지 않는다.
//  - 예외가 새어 나가면 stdout 전체가 잘리므로 모든 케이스는 try/catch 안에서 돈다.
//  - 텍스트 단언은 접근성 트리가 아니라 DOM textContent(text())로 한다.
//  - 클라이언트 라우팅 뒤 p.url()은 갱신되지 않으므로 path()를 쓴다.
//  - getByRole(한글 name)은 깨진다 → CSS locator만 쓴다.
const BASE = (typeof globalThis.E2E_BASE_URL === 'string' && globalThis.E2E_BASE_URL) || 'http://localhost:3100';
const R = [];
let CURRENT_SECTION = '';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function section(name) { CURRENT_SECTION = name; console.log('SECTION ' + name); }
function ok(name, pass, detail) {
  const id = (CURRENT_SECTION ? CURRENT_SECTION + ' / ' : '') + name;
  R.push({ id, pass: !!pass, detail: detail === undefined ? '' : String(detail).slice(0, 300) });
  console.log((pass ? 'PASS ' : 'FAIL ') + id + (detail === undefined ? '' : ' — ' + String(detail).slice(0, 300)));
  return !!pass;
}
function skip(name, why) { const id = (CURRENT_SECTION ? CURRENT_SECTION + ' / ' : '') + name; R.push({ id, pass: true, skipped: true, detail: why }); console.log('SKIP ' + id + ' — ' + why); }
async function path(p) { return p.evaluate(() => location.pathname + location.search); }
async function text(p) { return p.evaluate(() => document.body.innerText); }
async function has(p, re) { return re.test(await text(p)); }
async function count(p, sel) { return p.locator(sel).count(); }
async function attr(p, sel, name) { return p.evaluate(({ sel, name }) => { const el = document.querySelector(sel); return el ? el.getAttribute(name) : null; }, { sel, name }); }
async function go(p, rel, settle) { await p.goto(BASE + rel); await wait(settle === undefined ? 2500 : settle); }
// 조건이 참이 될 때까지 폴링. 네트워크 idle 대기보다 안정적이다(RSC 스트리밍·React Query 재조회 때문에).
async function until(p, fn, ms, step) {
  const deadline = Date.now() + (ms || 15000);
  while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) {} await wait(step || 400); }
  return null;
}
async function untilText(p, re, ms) { return until(p, async () => (re.test(await text(p)) ? true : null), ms); }
async function json(p, rel, init) {
  // 페이지 컨텍스트에서 fetch → 브라우저 쿠키 그대로 사용. 상태코드와 본문을 함께 돌려준다.
  return p.evaluate(async ({ rel, init }) => { const r = await fetch(rel, init); let body = null; try { body = await r.json(); } catch (e) { body = null; } return { status: r.status, body }; }, { rel: rel.startsWith('http') ? rel : BASE + rel, init: init || {} });
}
async function session(p) { const r = await json(p, '/api/auth/session'); return r.body && r.body.data ? r.body.data : null; }
async function shot(p, name) {
  // 로컬 파일 저장이 안 되므로 base64로 흘리고 run.sh가 복원한다.
  try { const b = await p.screenshot({ type: 'jpeg', quality: 55 }); console.log('B64START ' + name); console.log(Buffer.from(b).toString('base64')); console.log('B64END'); } catch (e) { console.log('SHOT_ERR ' + name + ' ' + String(e)); }
}
// 뷰포는 앱 껍데기가 max-w-md(448px) 고정이라 모바일 폭으로 맞춘다. 좌표 단언은 getBoundingClientRect로 한다.
async function rect(p, sel) { return p.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; }, sel); }
async function viewport(p) { return p.evaluate(() => ({ w: innerWidth, h: innerHeight, scrollW: document.documentElement.scrollWidth })); }
async function noHorizontalOverflow(p) { const v = await viewport(p); return v.scrollW <= v.w + 1; }
// about:blank 에서는 앱으로의 fetch 가 교차출처로 막힌다 → 같은 출처의 가벼운 JSON 라우트에서 시작한다.
async function newPage() { const p = await openTab(BASE + '/api/auth/session'); try { await p.setViewportSize({ width: 430, height: 900 }); } catch (e) {} return p; }
async function closePage(p) { try { await p.close(); } catch (e) {} }
// 케이스 래퍼: 실패해도 다음 케이스로 간다. 스펙 본문 예외가 stdout을 삼키지 않게 하는 마지막 벽.
async function run(name, fn) { try { await fn(); } catch (e) { ok(name + ' (예외)', false, (e && e.message) || String(e)); } }
// DOM 기반 클릭: 화면 밖(긴 페이지 하단)이나 sticky 바에 가려진 요소는 locator.click()이 "ready" 대기에서 죽는다.
// selector 로 후보를 모으고 textRe(선택)로 고른 뒤 scrollIntoView + el.click(). React 합성 이벤트는 el.click()으로도 발화한다.
async function domClick(p, selector, textRe) {
  const src = textRe ? textRe.source : null; const flags = textRe ? textRe.flags : '';
  return p.evaluate(({ selector, src, flags }) => {
    const re = src === null ? null : new RegExp(src, flags);
    const el = [...document.querySelectorAll(selector)].find((e) => !re || re.test((e.textContent || '').trim()));
    if (!el) return false;
    el.scrollIntoView({ block: 'center' }); el.click(); return true;
  }, { selector, src, flags });
}
// DOM 기반 텍스트 존재 확인: innerText 가 누락하는 영역(긴 페이지·특정 컨테이너)은 textContent 로 본다.
async function domHas(p, selector, textRe) {
  const src = textRe.source, flags = textRe.flags;
  return p.evaluate(({ selector, src, flags }) => { const re = new RegExp(src, flags); return [...document.querySelectorAll(selector)].some((e) => re.test((e.textContent || '').trim())); }, { selector, src, flags });
}
async function domCount(p, selector, textRe) {
  const src = textRe ? textRe.source : null, flags = textRe ? textRe.flags : '';
  return p.evaluate(({ selector, src, flags }) => { const re = src === null ? null : new RegExp(src, flags); return [...document.querySelectorAll(selector)].filter((e) => !re || re.test((e.textContent || '').trim())).length; }, { selector, src, flags });
}
// 세션 보장: DID 세션이 없으면 로그인 화면에서 mock DID(모바일신분증) 인증을 수행한다.
// BE mock identity 는 항상 같은 didHash 를 주므로 재로그인해도 같은 사용자(지갑 바인딩 유지)다.
async function ensureLogin(p, country) {
  let s = await session(p);
  if (s && s.didVerified) return s;
  await go(p, '/login', 2000);
  await domClick(p, '[aria-label="거주국 선택"] button', new RegExp('^' + (country || 'KR') + '$')); await wait(300);
  await domClick(p, 'button', /모바일신분증으로 인증/);
  s = await until(p, async () => { const x = await session(p); return x && x.didVerified ? x : null; }, 15000, 700);
  return s;
}
async function logout(p) { const r = await json(p, '/api/auth/logout', { method: 'POST' }); await wait(500); return r.status; }
