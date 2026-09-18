import "client-only";

import { ASSET_COST_COLUMNS, EXCEPTION_COLUMNS, FILING_SUMMARY_COLUMNS, LEDGER_COLUMNS } from "@/lib/export/report";

/**
 * 인쇄 보고서가 보이는 열.
 *
 * XLSX는 열을 다 싣는다(원장 36열, 자산별 17열) — 세무사가 정렬·필터로 파고드는 파일이기 때문이다.
 * 인쇄물은 **읽는 문서**라 A4 한 폭에 안 들어가는 표는 읽히지 않는다. 그래서 신고에 직접 쓰이는
 * 열만 남기고, 나머지는 같은 자료가 XLSX에 있다고 문서에 적는다 — 줄여 놓고 말하지 않으면
 * "빠뜨린 자료"가 된다.
 *
 * 열 이름은 report.ts의 상수에서 골라 온다. 문자열을 다시 적으면 저쪽 열 이름이 바뀔 때
 * 인쇄물만 조용히 빈 칸을 그린다.
 */

const pick = <T extends readonly string[]>(columns: T, names: readonly string[]): string[] => {
  const known = new Set<string>(columns);
  const missing = names.filter((name) => !known.has(name));
  // 열 이름이 어긋나면 빈 칸을 그리는 대신 즉시 터뜨린다. 보고서의 빈 칸은 "0원"으로 읽힌다.
  if (missing.length > 0) throw new Error(`인쇄 보고서가 모르는 열을 골랐다: ${missing.join(", ")}`);
  return [...names];
};

/** 신고 요약서는 세 열이 전부라 그대로 쓴다 — 이 표가 보고서의 본문이다. */
export const PRINT_FILING_COLUMNS = [...FILING_SUMMARY_COLUMNS];

export const PRINT_ASSET_COLUMNS = pick(ASSET_COST_COLUMNS, [
  "자산",
  "당기양도수량",
  "총평균단가",
  "적용취득가액",
  "양도가액",
  "손익",
]);

export const PRINT_LEDGER_COLUMNS = pick(LEDGER_COLUMNS, [
  "거래일시_KST",
  "asset_symbol",
  "classification",
  "정규화수량",
  "원화양도가액",
  "원화취득가액",
  "손익",
  "과세판정",
]);

export const PRINT_EXCEPTION_COLUMNS = pick(EXCEPTION_COLUMNS, ["구분", "내용", "금액영향_원"]);

/** 열 머리글을 사람이 읽는 말로. 원장은 스키마 이름(스네이크)을 그대로 쓰므로 표에서만 바꾼다. */
const HEADER_LABEL: Record<string, string> = {
  거래일시_KST: "거래일시",
  asset_symbol: "자산",
  classification: "분류",
  정규화수량: "수량",
  원화양도가액: "양도가액",
  원화취득가액: "취득가액",
  금액영향_원: "금액 영향",
};

export const headerLabel = (column: string): string => HEADER_LABEL[column] ?? column;

/** 오른쪽 정렬할 열(금액·수량). 숫자를 왼쪽에 붙이면 자릿수를 눈으로 못 맞춘다. */
const NUMERIC = new Set([
  "금액", "당기양도수량", "총평균단가", "적용취득가액", "양도가액", "손익", "정규화수량",
  "원화양도가액", "원화취득가액", "금액영향_원",
]);

export const isNumericColumn = (column: string): boolean => NUMERIC.has(column);

/**
 * 절대 접히면 안 되는 짧은 라벨 열.
 *
 * 표 레이아웃은 내용이 넓은 열에 폭을 몰아준다. 예외 표의 「내용」에는 줄바꿈 기회가 없는 100자짜리
 * 이벤트 id가 들어 있어서, 그냥 두면 「구분」이 한 글자 폭까지 밀려 "제/외/자/산"으로 쪼개진다
 * (룰셋 비교 카드에서 배지가 뭉개진 것과 같은 원인이다).
 */
const NOWRAP = new Set(["구분", "기입란", "자산", "거래일시_KST", "asset_symbol", "classification"]);

export const isNowrapColumn = (column: string): boolean => NOWRAP.has(column);
