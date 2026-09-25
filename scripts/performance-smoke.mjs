// Read-only public pages plus opening/cancelling CX; never submits an identity or signature.
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';
const origin = process.env.PERF_ORIGIN || 'https://verawallet.pelicanlab.dev';
const output = process.env.PERF_OUTPUT || '/tmp/verawallet-performance.json';
const allowed = new Set('login verify report did-wallet install api report-vc capabilities auth session opendid issuer verifier api v1 certificate-vc oacx ent esign oacx-vendor.js oacx-ux.js oacx-ux.css config.mid.json'.split(' '));
function label(raw) {
  const u = new URL(raw);
  const group = u.origin === new URL(origin).origin ? 'vera' : u.hostname.endsWith('.raonsecure.co.kr') ? 'cx' : 'external';
  return group + ':' + u.pathname.split('/').map(s => !s || allowed.has(s) ? s : ':id').join('/');
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  const report = { measuredAt: new Date().toISOString(), location: 'Korea Mac mini; not Japan/mobile carrier', samples: [] };
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext(mobile ? { ...devices['Pixel 7'] } : {});
      const page = await context.newPage();
      let requests = [];
      page.on('requestfinished', async req => {
        const timing = req.timing();
        if (timing.responseEnd < 0) return;
        requests.push({ name: label(req.url()), method: req.method(), durationMs: Math.round(timing.responseEnd), headersMs: Math.round(timing.responseStart), status: (await req.response())?.status() });
      });
      page.on('requestfailed', req => requests.push({ name: label(req.url()), failed: true, durationMs: Math.round(req.timing().responseEnd) }));
      for (const route of ['/login', '/did-wallet/install', '/verify/report']) {
        requests = [];
        await page.goto(origin + route + '?perf=1', { waitUntil: 'load', timeout: 45000 });
        await page.waitForTimeout(1500);
        const navigation = await page.evaluate(() => {
          const n = performance.getEntriesByType('navigation')[0];
          return { ttfbMs: n.responseStart, domContentLoadedMs: n.domContentLoadedEventEnd, loadMs: n.loadEventEnd };
        });
        report.samples.push({ device: mobile ? 'mobile-emulated' : 'desktop', route, navigation, requests: [...requests], diagnostics: await page.evaluate(() => window.veraPerformance?.snapshot() || []) });
      }
      requests = [];
      await page.goto(origin + '/login?perf=1', { waitUntil: 'load' });
      const button = page.getByRole('button', { name: '모바일신분증으로 시작하기', exact: true });
      if (await button.count()) {
        requests = [];
        const started = Date.now();
        await button.click();
        await page.waitForTimeout(18000);
        const frames = page.frames().length;
        const cancel = page.getByRole('button', { name: '취소하고 돌아가기' });
        // Physical click: the host cancel control must stay above the SDK overlay.
        if (await cancel.count()) { await cancel.click(); await button.waitFor(); }
        await page.waitForTimeout(100);
        report.samples.push({ device: mobile ? 'mobile-emulated' : 'desktop', route: 'cx-open-only', observationMs: Date.now() - started, frames, requests: [...requests], diagnostics: await page.evaluate(() => window.veraPerformance?.snapshot() || []) });
      }
      await context.close();
    }
  } finally { fs.writeFileSync(output, JSON.stringify(report, null, 2)); await browser.close(); }
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, pages: report.samples.map(s => ({ device: s.device, route: s.route, navigation: s.navigation, failedRequests: s.requests.filter(r => r.failed).length, slowest: [...s.requests].sort((a,b) => b.durationMs - a.durationMs).slice(0, 4) })) }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
