/** Offline layout audit of real components. No accounts, API calls, or production data.
 * Run: node scripts/check-value-layout.mjs [artifact-directory]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const artifacts = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "verawallet-layout-"));
fs.mkdirSync(artifacts, { recursive: true });

// Resolve local TS/TSX only; external packages use the application's own dependencies.
// Rendering the real components avoids maintaining a separate imitation of their CSS.
const modules = new Map();
function load(file) {
  const base = path.isAbsolute(file) ? file : path.join(root, file);
  const resolved = [base, `${base}.tsx`, `${base}.ts`, `${base}.json`, path.join(base, "index.ts")]
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!resolved) throw new Error(`Cannot resolve fixture dependency: ${file}`);
  if (resolved.endsWith(".json")) return JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (modules.has(resolved)) return modules.get(resolved).exports;
  const loadedModule = { exports: {} };
  modules.set(resolved, loadedModule);
  const code = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
    fileName: resolved,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const localRequire = (name) => name.startsWith("@/") ? load(name.slice(2))
    : name.startsWith(".") ? load(path.resolve(path.dirname(resolved), name)) : require(name);
  new Function("require", "module", "exports", code)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const { ReportSummary } = load("components/report/report-summary");
const { ReportCard } = load("components/report/report-card");
const { SummaryCard } = load("components/ui/summary-card");
const { VerificationResultView } = load("components/report-vc/verification-result");
const { fixtureVerificationResult } = load("lib/report-vc/fixtures");
const { CopyValue } = load("components/report-vc/primitives");
const { WalletPortfolio } = load("components/wallet/wallet-portfolio");
const { EventRow } = load("components/transactions/event-row");
const { EVIDENCE_FIXTURE_ESTIMATE: baseEstimate } = load("tests/fixtures/evidence-estimate");
const { REPORT_FIXTURE_EVENTS: events } = load("tests/fixtures/report-events");
const tailwind = require("@tailwindcss/postcss");
const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
const css = (await postcss([tailwind({ base: root })]).process(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;

const sizes = [320, 375, 393, 430, 768];
const amounts = ["0", "100000", "24030048573", "-24030048573.12345678", "999999999999999999999999999999.99"];
const fontSizes = [16, 32];
const cases = [];
function fixture(amount) {
  const estimate = structuredClone(baseEstimate);
  for (const key of ["taxableGains", "exemptGains", "incomeTotal", "taxableBase", "estimatedCharge"]) estimate.totals[key] = amount;
  estimate.lines = estimate.lines.map((line) => ({ ...line, amount }));
  estimate.judgments = estimate.judgments.map((row) => ({ ...row, amount, ...(row.breakdown ? { breakdown: { proceeds: amount, cost: "1", fee: "0" } } : {}) }));
  const event = { ...events[0], fiat_value: amount, raw_amount: "999999999999999123456789000000000", asset_symbol: "LONGTOKENNAME" };
  const address = `0x${"ab".repeat(20)}`;
  const token = { key: "1:native", symbol: "ETH", name: "Ethereum", chainId: 1, chainName: "Ethereum", contract: null, isNft: false, amount: "999999999.123456789", priceKrw: amount, valueKrw: amount, priceStatus: "priced", costKrw: "1", costStatus: "ready", canonicalAssetId: null };
  const verification = fixtureVerificationResult("with_amounts");
  verification.claims.totals = { currency: "KRW", estimatedCharge: amount, taxableGains: amount, incomeTotal: amount };
  const card = (name, children) => h("section", { "data-layout-fixture": name, className: name === "wallet-portfolio" ? "my-5 -mx-5 min-w-0" : "my-5 min-w-0" }, children);
  return renderToStaticMarkup(h("main", { className: "mx-auto w-full max-w-md px-5 py-5" },
    card("report-summary", h(ReportSummary, { result: estimate, hasNothingToCompute: false, comparingLabel: null, onReturnHome() {} })),
    card("report-details", h(ReportCard, { estimate })),
    card("dashboard-summary", h(SummaryCard, { label: "예상 손익", value: `₩${amount}` })),
    card("transaction-row", h(EventRow, { record: { event, version: 1 }, rows: [estimate.judgments[0]], currency: "KRW", isExcluded: false, inPeriod: true, isDuplicate: false })),
    card("wallet-portfolio", h(WalletPortfolio, { address, chains: [], tokens: [token], nfts: [], defi: [], provenance: "live", asOf: null })),
    card("vc-verification", h(VerificationResultView, { result: verification, provenance: "live" })),
    card("full-identifiers-without-clipboard", h("div", { className: "rounded-card border border-zinc-200 p-5" },
      h(CopyValue, { label: "주소", value: address }),
      h(CopyValue, { label: "DID", value: `did:omn:${"a".repeat(180)}` }),
      h(CopyValue, { label: "거래 해시", value: `0x${"ef".repeat(32)}` }),
    )),
  ));
}

// DOM geometry, not a class-name assertion: catches min-width, nowrap and clipping regressions.
function detectOverflow() {
  const issues = [];
  const identify = (element) => ({ component: element.closest("[data-layout-fixture]")?.getAttribute("data-layout-fixture"), tag: element.tagName, text: element.textContent?.trim().slice(0, 90) });
  for (const el of document.querySelectorAll("[data-layout-fixture] *")) {
    if (el.closest(".sr-only, .truncate, pre, svg") || !el.textContent?.trim()) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || !el.getClientRects().length) continue;
    if (["auto", "scroll"].includes(style.overflowX)) continue;
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) issues.push({ ...identify(el), kind: "content-overflow", excess: el.scrollWidth - el.clientWidth });
  }
  for (const el of document.querySelectorAll("[data-layout-value]")) {
    const range = document.createRange(); range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects());
    for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const box = parent.getBoundingClientRect();
      if (!box.width || getComputedStyle(parent).display === "inline") continue;
      if (rects.some((rect) => rect.left < box.left - 1 || rect.right > box.right + 1)) {
        issues.push({ ...identify(el), kind: "value-outside-container", parent: parent.tagName }); break;
      }
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) issues.push({ kind: "viewport-overflow" });
  return issues;
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  // The fixture never needs remote resources, including fonts and token icons.
  await page.route("**/*", (route) => route.abort());
  for (const width of sizes) for (const fontSize of fontSizes) for (const amount of amounts) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`<!doctype html><html lang="ko" style="font-size:${fontSize}px"><head><style>${css}</style></head><body>${fixture(amount)}</body></html>`);
    const issues = await page.evaluate(detectOverflow);
    cases.push({ width, fontSize, amount, issues });
    if (issues.length || (width === 393 && fontSize === 16 && amount === "24030048573")) await page.screenshot({ path: path.join(artifacts, `${width}-${fontSize}-${amount.replaceAll(".", "_")}.png`), fullPage: true });
  }
  // Verify that the detector can actually reject broken numeric and address containers.
  await page.setContent('<div data-layout-fixture="negative-control" style="width:70px"><span data-layout-value style="white-space:nowrap">₩24,030,048,573 / did:omn:abcdefghijklmnopqrstuvwxyz</span></div>');
  if (!(await page.evaluate(detectOverflow)).length) throw new Error("Overflow detector failed its negative control");
} finally { await browser.close(); }
fs.writeFileSync(path.join(artifacts, "results.json"), JSON.stringify(cases, null, 2));
const failed = cases.filter((item) => item.issues.length);
console.log(JSON.stringify({ cases: cases.length, failed: failed.length, artifacts, failures: failed }, null, 2));
if (failed.length) process.exitCode = 1;
