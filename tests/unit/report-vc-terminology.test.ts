import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(tsx?|md)$/.test(entry.name) ? [path] : [];
  });
}

const SOURCES = [
  ...files("lib/report-vc"),
  ...files("components/report-vc"),
  ...files("app/verify"),
  "docs/opendid-report-vc-api-contract.md",
];

describe("report VC wording", () => {
  it("never calls the credential an official filing, a paid tax, or a guarantee of accuracy", () => {
    const forbidden = ["공식 신고서", "납세 완료", "세금 정확성 보증", "정확성을 보증", "세액", "납부할 세금", "신고서"];
    for (const file of SOURCES) {
      const source = readFileSync(file, "utf8");
      for (const term of forbidden) expect(source, `${file} contains ${term}`).not.toContain(term);
    }
  });

  it("names the credential consistently", () => {
    const named = SOURCES.filter((file) => readFileSync(file, "utf8").includes("추정 세금 리포트 증명서"));
    expect(named.length).toBeGreaterThan(0);
  });

  it("does not use an em dash in Korean copy or comments", () => {
    for (const file of SOURCES) {
      expect(readFileSync(file, "utf8"), `${file} contains an em dash`).not.toContain("—");
    }
  });

  it("shows amounts in KRW only", () => {
    const view = readFileSync("components/report-vc/verification-result.tsx", "utf8");
    const currencies = [...view.matchAll(/formatFiat\([^)]*,\s*"([A-Z]{3})"\)/g)].map((match) => match[1]);
    expect(currencies.length).toBeGreaterThan(0);
    expect(new Set(currencies)).toEqual(new Set(["KRW"]));
  });
});
