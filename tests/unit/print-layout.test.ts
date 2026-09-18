import { describe, expect, it } from "vitest";

import { ASSET_COST_COLUMNS, EXCEPTION_COLUMNS, FILING_SUMMARY_COLUMNS, LEDGER_COLUMNS } from "@/lib/export/report";
import {
  PRINT_ASSET_COLUMNS,
  PRINT_EXCEPTION_COLUMNS,
  PRINT_FILING_COLUMNS,
  PRINT_LEDGER_COLUMNS,
  headerLabel,
  isNowrapColumn,
  isNumericColumn,
} from "@/lib/export/print-layout";

/**
 * 인쇄 보고서가 고른 열이 report.ts의 열 이름과 실제로 맞는지.
 * 어긋나면 표가 빈 칸을 그리는데, 보고서의 빈 칸은 "0원"으로 읽힌다.
 * (이 가드가 실제로 `과세판정`을 자산별 열로 잘못 고른 것을 잡았다 — 그 열은 원장에만 있다.)
 */
describe("인쇄 보고서 열 선택", () => {
  const cases: Array<[string, readonly string[], readonly string[]]> = [
    ["신고 요약", PRINT_FILING_COLUMNS, FILING_SUMMARY_COLUMNS],
    ["자산별", PRINT_ASSET_COLUMNS, ASSET_COST_COLUMNS],
    ["원장", PRINT_LEDGER_COLUMNS, LEDGER_COLUMNS],
    ["예외", PRINT_EXCEPTION_COLUMNS, EXCEPTION_COLUMNS],
  ];

  it.each(cases)("%s의 인쇄 열은 모두 원본 열에 있다", (_name, printed, source) => {
    expect(printed.length).toBeGreaterThan(0);
    for (const column of printed) expect(source).toContain(column);
  });

  it("신고 요약은 열을 줄이지 않는다 — 이 표가 보고서의 본문이다", () => {
    expect(PRINT_FILING_COLUMNS).toEqual([...FILING_SUMMARY_COLUMNS]);
  });
});

describe("열 표시 규칙", () => {
  it("금액·수량은 오른쪽 정렬 대상이다", () => {
    for (const column of ["금액", "손익", "양도가액", "원화취득가액", "금액영향_원"]) {
      expect(isNumericColumn(column), column).toBe(true);
    }
    expect(isNumericColumn("자산")).toBe(false);
  });

  // 「구분」이 접히면 긴 이벤트 id가 옆 열을 한 글자 폭까지 밀어 "제/외/자/산"으로 쪼갠다.
  it("짧은 라벨 열은 접히지 않는다", () => {
    expect(isNowrapColumn("구분")).toBe(true);
    expect(isNowrapColumn("기입란")).toBe(true);
    expect(isNowrapColumn("내용")).toBe(false);
  });

  it("스키마 이름을 쓰는 원장 열은 사람이 읽는 머리글로 바꾼다", () => {
    expect(headerLabel("asset_symbol")).toBe("자산");
    expect(headerLabel("거래일시_KST")).toBe("거래일시");
    expect(headerLabel("손익")).toBe("손익");
  });
});
