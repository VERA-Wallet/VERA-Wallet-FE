// 00: 하네스 자체가 살아 있는지(스모크). 이 스펙이 빨간색이면 다른 스펙 결과는 의미가 없다.
section('00 하네스 스모크');
const p = await newPage();
await run('세션 API 응답', async () => {
  const r = await json(p, '/api/auth/session');
  ok('GET /api/auth/session 이 JSON 을 준다', r.status === 200 && r.body && 'data' in r.body, 'status=' + r.status);
  const s = r.body && r.body.data;
  ok('세션 페이로드 필드(didVerified·countryCode·walletAddress·walletVerification)', s && ['didVerified', 'countryCode', 'walletAddress', 'walletVerification'].every((k) => k in s), JSON.stringify(s));
});
await run('루트 리다이렉트', async () => {
  await go(p, '/', 2000);
  const s = await session(p);
  const where = await path(p);
  ok('/ → ' + (s && s.didVerified ? '/dashboard' : '/login'), s && s.didVerified ? where.startsWith('/dashboard') : where.startsWith('/login'), where);
});
await closePage(p);
