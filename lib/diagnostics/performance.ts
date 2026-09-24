export type Timing = { kind: string; name: string; durationMs: number; atMs: number; outcome?: string; server?: { name: string; duration: number }[] };
const entries: Timing[] = [];
let enabled = false;
let navigation: { path: string; start: number } | undefined;
const segments = new Set("api auth session nonce verify did offer present wallet wallets watch portfolio holdings events summary resync tax estimate rulesets tax-evidence chain anchor-proof report-vc capabilities link-attempts issuances verifications cancel file-check settings verify-identity export basis dashboard login connect verify report did-wallet install opendid issuer verifier tas ca wallet-service api-gateway list vc vcschema api v1 certificate-vc request-profile request-verify request-offer-qr confirm-verify".split(" "));
export function safePath(value: string) {
  try {
    const url = new URL(value, "https://local.invalid");
    return url.pathname.split("/").map(part => !part || segments.has(part) ? part : ":id").join("/");
  } catch { return "unknown"; }
}
export function recordTiming(entry: Timing) {
  if (!enabled) return;
  entries.push(entry);
  if (entries.length > 500) entries.shift();
}
export async function measure<T>(name: "wallet.connect_approval" | "wallet.sign_approval" | "cx.interactive_flow", work: () => Promise<T>): Promise<T> {
  const start = performance.now(); let outcome = "ok";
  try { return await work(); } catch (error) { outcome = "error"; throw error; }
  finally { recordTiming({ kind: "interaction", name, durationMs: performance.now() - start, atMs: start, outcome }); }
}
export function navigationStarted(url: string) { navigation = { path: safePath(url), start: performance.now() }; }
export function navigationCommitted(path: string) {
  if (!navigation || navigation.path !== safePath(path)) return;
  recordTiming({ kind: "route_commit", name: navigation.path, durationMs: performance.now() - navigation.start, atMs: navigation.start });
  navigation = undefined;
}
export function installPerformanceDiagnostics() {
  try {
    if (new URLSearchParams(location.search).get("perf") === "1") localStorage.setItem("vera:performance", "1");
    enabled = localStorage.getItem("vera:performance") === "1";
  } catch { /* Storage may be disabled. */ }
  Object.assign(window, { veraPerformance: {
    enable() { enabled = true; try { localStorage.setItem("vera:performance", "1"); } catch {} },
    disable() { enabled = false; entries.length = 0; try { localStorage.removeItem("vera:performance"); } catch {} },
    snapshot() { return structuredClone(entries); }, clear() { entries.length = 0; },
  } });
  if (typeof PerformanceObserver === "undefined") return;
  for (const type of ["resource", "navigation", "longtask", "largest-contentful-paint"]) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const resource = entry as PerformanceResourceTiming;
        let prefix = "";
        if (type === "resource") {
          try { const url = new URL(entry.name); if (url.origin !== location.origin) prefix = url.hostname.endsWith(".raonsecure.co.kr") ? "cx:" : "external:"; } catch {}
        }
        recordTiming({ kind: type, name: type === "resource" || type === "navigation" ? prefix + safePath(entry.name) : type,
          durationMs: type === "largest-contentful-paint" ? entry.startTime : entry.duration, atMs: entry.startTime,
          ...(resource.serverTiming ? { server: resource.serverTiming.map(t => ({ name: t.name, duration: t.duration })) } : {}),
        });
      }
    });
    observer.observe({ type, buffered: true });
  }
}
