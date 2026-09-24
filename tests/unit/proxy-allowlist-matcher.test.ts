import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { config } from "@/proxy";

// 정적 소스 가드: `isBackendOwned`의 `startsWith` 접두사는 런타임에서 꺼낼 수 없으므로(내부 함수, export 아님)
// proxy.ts 소스 텍스트를 직접 읽어 대조한다. §1-C의 결함(allowlist에는 있는데 matcher에 없어 proxy가 안 타는 것)이
// 정확히 이 틈에서 났다 — 소스를 읽지 않으면 같은 결함이 다시 조용히 들어온다.
const source = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");

function extractSet(name: string): string[] {
  const match = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`).exec(source);
  if (!match) throw new Error(`could not find ${name} in proxy.ts`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function extractStartsWithPrefixes(): string[] {
  const fn = /function isBackendOwned\(pathname: string\): boolean \{([\s\S]*?)\n\}/.exec(source);
  if (!fn) throw new Error("could not find isBackendOwned in proxy.ts");
  return [...fn[1].matchAll(/pathname\.startsWith\("([^"]+)"\)/g)].map((m) => m[1]);
}

describe("proxy allowlist/matcher wiring", () => {
  it("has a matcher entry for every exact-match BACKEND_OWNED_PATHS entry", () => {
    const backendOwnedPaths = extractSet("BACKEND_OWNED_PATHS");
    expect(backendOwnedPaths.length).toBeGreaterThan(0);
    for (const path of backendOwnedPaths) {
      expect(config.matcher, `matcher missing exact entry for allowlisted path ${path}`).toContain(path);
    }
  });

  it("has a matcher entry for every startsWith prefix isBackendOwned checks (incl. :path*/:address forms)", () => {
    const prefixes = extractStartsWithPrefixes();
    // 알려진 접두 목록(`/api/events/`·`/api/tax-evidence/`·`/api/auth/wallets/`·`/api/report-vc/`).
    // 목록이 소스에서 바뀌면 이 단언이 먼저 깨져, 새 접두를 놓치지 않았는지 검토를 강제한다.
    expect(prefixes.sort()).toEqual(["/api/auth/wallets/", "/api/events/", "/api/tax-evidence/", "/api/report-vc/"].sort());

    for (const prefix of prefixes) {
      // 접두는 정확 일치 목록에 없어 첫 검사만으로는 안 잡힌다 — matcher에 그 접두를 여는 `:path*` 또는 `:address` 패턴이 있어야 한다.
      const base = prefix.slice(0, -1); // trailing "/" 제거
      const hasDynamicEntry = config.matcher.some((entry) => entry.startsWith(`${base}/:`));
      expect(hasDynamicEntry, `matcher missing a dynamic (:path*/:address) entry opening prefix ${prefix}`).toBe(true);
    }
  });

  it("never lets a /api/mock/ control route reach the allowlist or matcher", () => {
    const backendOwnedPaths = extractSet("BACKEND_OWNED_PATHS");
    const prefixes = extractStartsWithPrefixes();

    expect(backendOwnedPaths.some((path) => path.startsWith("/api/mock/"))).toBe(false);
    expect(prefixes.some((prefix) => prefix.startsWith("/api/mock/"))).toBe(false);
    expect(config.matcher.some((entry) => entry.startsWith("/api/mock/"))).toBe(false);
  });
});
