import { ZERO, isNegative, sum } from "@/lib/tax/decimal";
import type { Decimal } from "@/lib/tax/decimal";
import { formatFiat } from "@/lib/format";
import {
  EXCEPTION_ROW_LIMIT,
  STATUS_BADGE,
  cellText,
  decimalOf,
  generatedAtText,
  groupedAmount,
  groupedCellText,
  quantityText,
  unitLabel,
} from "@/lib/export/report-format";
import { halfOpenPeriodLabel } from "@/lib/period";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { ruleNotesOf } from "@/lib/tax/limitations";
import type { TaxEstimate } from "@/lib/tax/types";
import {
  FILING_LINE_SPECS,
  buildAssetCostDetail,
  buildExceptions,
  buildFilingSummary,
  filingConfidenceNote,
  filingRow,
  type FilingLineRole,
  type ReportRow,
} from "@/lib/export/report";

/**
 * 신고 근거자료 **보고서** — 같은 estimate를 스프레드시트가 아니라 사람이 읽는 종이로 낸다.
 *
 * XLSX(`report-workbook.ts`)는 세무사가 수식을 걸 수 있게 값만 격자에 담고, 이 문서는 그 값들이
 * **어떤 순서로 어떻게 계산됐는지**를 보인다. 두 산출물은 언제나 같은 빌더(`report.ts`)에서만 값을 읽는다 —
 * 여기서 룰셋 조건이나 위계를 다시 쓰면 같은 지갑을 두고 엑셀과 PDF가 다른 답을 말하게 된다.
 *
 * 한글 PDF를 브라우저 밖에서 만들려면 폰트를 통째로 내장해야 한다(수 MB). 그래서 이 파일은 PDF를
 * 직접 쓰지 않고 **인쇄용 HTML 한 장**을 낸다: 조판은 CSS가 하고, PDF 변환은 브라우저의 인쇄가 한다.
 * 덕분에 시스템 한글 폰트를 그대로 쓰고 새 의존성이 0이다(`print.ts`가 그 인쇄를 띄운다).
 *
 * 순수 함수다 — DOM도 시계도 읽지 않고 `meta.generatedAt`을 받는다. 그래야 테스트가 문서를 고정할 수 있다.
 */

export type ReportMeta = {
  /** 작성 시각(ISO). 문서에 찍히는 유일한 "지금"이다 — 호출자가 주입해 테스트가 고정할 수 있게 한다. */
  generatedAt: string;
  /** 시행 전 계산 기준을 시행됐다고 **가정**하고 계산했는가. 가정은 답 옆에 계속 붙어 있어야 한다. */
  assumeEffective?: boolean;
  /** 그 계산 기준의 시행 연도. 가정 문구에만 쓴다. */
  effectiveYear?: number;
  /**
   * 이 계산을 OmniOne 체인에 봉인한 기록. 있으면 보고서가 "이 종이의 근거가 체인 어디에 있는지"를
   * 함께 말한다 — 종이만 오가는 문서는 나중에 고쳐도 아무도 모른다.
   */
  anchor?: {
    merkleRoot: string;
    txHash: string | null;
    anchoredAt: string | null;
    explorerUrl: string | null;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 이스케이프 — 이 문서는 같은 출처(iframe)에서 열린다. 심볼·증빙 URL 같은 외부 문자열이
// 태그로 살아나면 앱 출처에서 스크립트가 도는 셈이라, 모든 삽입은 이 함수를 지난다.
// ─────────────────────────────────────────────────────────────────────────────

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 표시 헬퍼 (값 포매팅은 report-format.ts — 종이와 앱 화면이 같은 글자를 쓴다)
// ─────────────────────────────────────────────────────────────────────────────

/** 자산별 명세의 금액 칸(기호 없음). 음수는 색이 아니라 부호로 먼저 읽힌다. */
function plainCell(value: string | number | undefined): string {
  const negative = typeof value === "number" && value < 0;
  return `<td class="num${negative ? " neg" : ""}">${escapeHtml(groupedCellText(value))}</td>`;
}

/** 금액 칸. 음수면 색으로만 구분하지 않도록 부호를 글자로 남긴다. */
function amountCell(value: string | number | undefined, currency: string): string {
  const text = cellText(value, currency);
  const negative = typeof value === "number" && value < 0;
  return `<td class="num${negative ? " neg" : ""}">${escapeHtml(text)}</td>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 섹션
// ─────────────────────────────────────────────────────────────────────────────

function metaRow(term: string, detail: string, wide = false): string {
  return `<div class="meta-row${wide ? " wide" : ""}"><dt>${escapeHtml(term)}</dt><dd>${detail}</dd></div>`;
}

function cover(
  events: readonly NormalizedEvent[],
  estimate: TaxEstimate | null,
  meta: ReportMeta,
  filing: readonly ReportRow[],
): string {
  // 대상 지갑은 파일에 실제로 들어간 거래에서 읽는다 — 등록만 하고 거래가 없는 지갑을 "대상"이라 적지 않는다.
  const wallets = [...new Set(events.map((event) => event.wallet_address.toLowerCase()))].sort();
  const walletHtml = wallets.length === 0
    ? "-"
    : `<span class="mono">${wallets.map((address) => escapeHtml(address)).join("</span><br><span class=\"mono\">")}</span>`;
  const badge = estimate ? STATUS_BADGE[estimate.status] : null;
  const period = estimate?.period ?? null;
  const subtitle = estimate
    ? `${estimate.taxYear}년 귀속 · ${estimate.countryLabel} · ${estimate.method}`
    : "계산 결과 없음";

  return `<header class="cover">
  <div class="cover-top">
    <p class="brand">VeraWallet</p>
    ${badge ? `<span class="badge ${badge.tone}">${escapeHtml(badge.label)}</span>` : ""}
  </div>
  <h1>기타소득 신고 근거자료</h1>
  <p class="subtitle">${escapeHtml(subtitle)}</p>
  <dl class="meta">
    ${metaRow("과세기간", escapeHtml(period ? halfOpenPeriodLabel(period) : "기간 미정"))}
    ${metaRow("거래 건수", `${escapeHtml(events.length.toLocaleString("ko-KR"))}건`)}
    ${metaRow("작성 시각", escapeHtml(generatedAtText(meta.generatedAt)))}
    ${metaRow("계산 신뢰도", escapeHtml(estimate ? filingConfidenceNote(estimate) : "-"))}
    ${metaRow("대상 지갑", walletHtml, true)}
    ${meta.anchor ? metaRow("계산 근거 머클루트", `<span class="mono">${escapeHtml(meta.anchor.merkleRoot)}</span>`, true) : ""}
  </dl>
  ${headline(estimate, filing, meta)}
</header>`;
}

/** 표지 아래 한 줄짜리 결론. 보고서를 펼친 사람이 가장 먼저 찾는 숫자다. */
function headline(estimate: TaxEstimate | null, filing: readonly ReportRow[], meta: ReportMeta): string {
  if (!estimate) {
    return `<section class="headline empty">
    <p class="headline-label">계산 결과</p>
    <p class="headline-value">계산할 거래 없음</p>
    <p class="headline-note">가격·분류를 확정한 거래가 없어 신고 금액을 내지 못했습니다. 아래 거래 원장(CSV·XLSX)으로 확인해 주세요.</p>
  </section>`;
  }
  const row = filingRow(filing, "예상 합계 부담");
  const assumption = meta.assumeEffective
    ? `<p class="assumption">시행 가정: ${escapeHtml(String(estimate.taxYear))}년 거래에 ${escapeHtml(String(meta.effectiveYear ?? ""))}년 시행 규칙(${escapeHtml(estimate.method)})을 적용했다고 <strong>가정한</strong> 금액이며, 현재 확정된 실제 부담이 아닙니다.</p>`
    : "";
  return `<section class="headline">
    <p class="headline-label">예상 합계 부담</p>
    <p class="headline-value">${escapeHtml(cellText(row?.금액, estimate.currency))}</p>
    <p class="headline-note">${escapeHtml(String(row?.근거 ?? "산출 소득세 + 개인지방소득세"))}</p>
    ${assumption}
  </section>`;
}

const ROLE_CLASS: Record<FilingLineRole, string> = {
  item: "",
  subtract: "subtract",
  subtotal: "subtotal",
  total: "total",
  note: "note",
};

/** 1. 신고 요약 — 별지 제40호서식(6) 기입란을 위에서 아래로 계산 순서대로. */
function filingSection(estimate: TaxEstimate, filing: readonly ReportRow[]): string {
  const body = FILING_LINE_SPECS.map((spec) => {
    const row = filingRow(filing, spec.source);
    // 룰셋이 내지 않은 줄은 0원으로 지어내지 않고 그 줄 자체를 빼 버린다.
    if (row === undefined) return "";
    const label = spec.role === "subtract" ? `(−) ${spec.source}` : spec.source;
    return `<tr class="${ROLE_CLASS[spec.role]}">
      <th scope="row">${escapeHtml(label)}</th>
      ${amountCell(row.금액, estimate.currency)}
      <td class="basis">${escapeHtml(String(row.근거 ?? ""))}</td>
    </tr>`;
  }).join("");

  return `<section class="block">
  <h2>1. 신고 요약</h2>
  <p class="lead">종합소득세 신고 별지 제40호서식(6)의 기입란과 1:1로 대응합니다. 금액은 아래 자산별 명세와 거래 원장에서 집계한 값입니다.</p>
  <table class="filing">
    <colgroup><col class="c-label"><col class="c-amount"><col class="c-basis"></colgroup>
    <thead><tr><th scope="col">기입란</th><th scope="col" class="num">금액</th><th scope="col">산출 근거</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
</section>`;
}

/**
 * 2. 자산별 취득가액 명세 — 취득 산정과 양도·손익을 **두 표로 나눈다.**
 *
 * 한 표에 11칸을 넣으면 금액이 10자리인 지갑에서 A4 본문 폭(184mm)을 넘겨 마지막 칸이 잘린다.
 * 근거자료에서 칸이 잘리는 것은 조판 문제가 아니라 자료가 없어지는 것이라, 폭에 기대지 않고 갈라 둔다.
 * 나누는 선은 서식과 같다: 취득가액을 어떻게 산정했는가(2-1)와 그래서 얼마를 벌었는가(2-2).
 */
function assetSection(estimate: TaxEstimate, rows: readonly ReportRow[]): string {
  if (rows.length === 0) {
    return `<section class="block">
  <h2>2. 자산별 취득가액 명세</h2>
  <p class="empty-note">취득·양도 기록이 있는 자산이 없습니다.</p>
</section>`;
  }

  const currency = estimate.currency;
  const unit = `<span class="unit">(금액 단위: ${escapeHtml(unitLabel(currency))})</span>`;

  // 합계는 위에 인쇄한 행을 그대로 더한 값이다 — estimate의 다른 합을 가져오면 표와 합계가 어긋난다.
  const total = (key: string): Decimal =>
    sum(rows.map((row) => (typeof row[key] === "number" ? decimalOf(row[key] as number) ?? ZERO : ZERO)));

  const acquisition = rows.map((row) => `<tr>
      <th scope="row">${escapeHtml(String(row.자산))}</th>
      <td class="num qty">${escapeHtml(quantityText(row.기초수량))}</td>
      ${plainCell(row.기초가액)}
      <td class="num qty">${escapeHtml(quantityText(row.당기취득수량))}</td>
      ${plainCell(row.당기취득가액)}
      ${plainCell(row.총평균단가)}
      <td class="deemed">${escapeHtml(String(row.의제취득가액적용여부))}</td>
    </tr>`).join("");

  const disposal = rows.map((row) => `<tr>
      <th scope="row">${escapeHtml(String(row.자산))}</th>
      <td class="num qty">${escapeHtml(quantityText(row.당기양도수량))}</td>
      ${plainCell(row.적용취득가액)}
      ${plainCell(row.양도가액)}
      ${plainCell(row.손익)}
    </tr>`).join("");

  const totalGain = total("손익");
  // 수령 소득(대여대가·에어드랍)은 처분이 아니라 이 표에 없다. 합계를 신고 요약의 총수입금액과
  // 같은 것으로 읽지 않도록, 그런 소득이 실제로 있을 때만 그 사실을 말한다.
  const hasIncome = estimate.judgments.some((row) => row.amountKind === "fmv" && row.group === "income");

  return `<section class="block">
  <h2>2. 자산별 취득가액 명세</h2>
  <h3>2-1. 취득가액 산정</h3>
  <p class="lead">${escapeHtml(estimate.method)}으로 산정했습니다. 총평균단가는 계산에 실제로 적용된 단가이며, 의제취득가액이 적용된 자산은 실제 취득단가보다 높습니다.${unit}</p>
  <table class="asset acquisition">
    <thead>
      <tr>
        <th scope="col" rowspan="2">자산</th>
        <th scope="col" colspan="2">기초(이월)</th>
        <th scope="col" colspan="2">당기 취득</th>
        <th scope="col" rowspan="2" class="num">총평균단가</th>
        <th scope="col" rowspan="2" class="deemed">의제<br>취득가액</th>
      </tr>
      <tr class="sub">
        <th scope="col" class="num">수량</th><th scope="col" class="num">가액</th>
        <th scope="col" class="num">수량</th><th scope="col" class="num">가액</th>
      </tr>
    </thead>
    <tbody>${acquisition}</tbody>
    <tfoot>
      <tr>
        <th scope="row">합계</th>
        <td></td>
        <td class="num">${escapeHtml(groupedAmount(total("기초가액")))}</td>
        <td></td>
        <td class="num">${escapeHtml(groupedAmount(total("당기취득가액")))}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>

  <h3>2-2. 당기 양도와 손익</h3>
  <p class="lead">위 2-1의 총평균단가를 양도수량에 곱한 값이 적용취득가액이고, 양도가액에서 그것을 뺀 값이 손익입니다.${unit}</p>
  <table class="asset disposal">
    <thead>
      <tr>
        <th scope="col">자산</th>
        <th scope="col" class="num">양도수량</th>
        <th scope="col" class="num">적용취득가액</th>
        <th scope="col" class="num">양도가액</th>
        <th scope="col" class="num">손익</th>
      </tr>
    </thead>
    <tbody>${disposal}</tbody>
    <tfoot>
      <tr>
        <th scope="row">합계</th>
        <td></td>
        <td class="num">${escapeHtml(groupedAmount(total("적용취득가액")))}</td>
        <td class="num">${escapeHtml(groupedAmount(total("양도가액")))}</td>
        <td class="num${isNegative(totalGain) ? " neg" : ""}">${escapeHtml(groupedAmount(totalGain))}</td>
      </tr>
    </tfoot>
  </table>
  ${hasIncome ? `<p class="foot-note">이 표의 합계는 <strong>자산 처분분</strong>만 더한 값입니다. 대여대가·에어드랍 등 수령 소득은 위 신고 요약의 총수입금액에 함께 들어가 있습니다.</p>` : ""}
</section>`;
}

/**
 * 관련 이벤트 id는 근거이지만 종이에서는 건수가 먼저다.
 *
 * 실데이터의 id는 `1:0x…:external`처럼 70자가 넘어, 여섯 개만 실어도 한 행이 100px을 넘고 예외가 40줄이면
 * 보고서가 목록이 된다. 짧은 id는 그대로 싣고(그 자리에서 추적이 된다), 긴 id는 건수만 남기고 파일로 넘긴다 —
 * 아래 각주가 XLSX 예외 시트와 CSV 원장을 가리킨다.
 */
const INLINE_ID_MAX_LENGTH = 24;

function eventIdsCell(raw: string): string {
  const ids = raw.split(",").map((id) => id.trim()).filter((id) => id.length > 0);
  if (ids.length === 0) return `<td class="ids">-</td>`;
  const inline = ids.every((id) => id.length <= INLINE_ID_MAX_LENGTH) ? ids.slice(0, 4) : [];
  const rest = ids.length - inline.length;
  const tail = inline.length > 0
    ? `<span class="mono">${inline.map((id) => escapeHtml(id)).join(", ")}${
        rest > 0 ? ` 외 ${escapeHtml(rest.toLocaleString("ko-KR"))}건` : ""
      }</span>`
    : "";
  return `<td class="ids"><span class="count">${escapeHtml(ids.length.toLocaleString("ko-KR"))}건</span>${tail}</td>`;
}

/** 3. 예외·판단보류 — 계산이 무엇을 못 했는지. 비어 있으면 비어 있다고 말한다. */
function exceptionSection(estimate: TaxEstimate, rows: readonly ReportRow[]): string {
  if (rows.length === 0) {
    return `<section class="block">
  <h2>3. 예외 · 판단보류</h2>
  <p class="empty-note">계산에서 제외되었거나 판단을 보류한 항목이 없습니다.</p>
</section>`;
  }
  const shown = rows.slice(0, EXCEPTION_ROW_LIMIT);
  const omitted = rows.length - shown.length;
  const body = shown.map((row) => `<tr>
      <th scope="row">${escapeHtml(String(row.구분))}</th>
      <td>${escapeHtml(String(row.내용))}</td>
      ${eventIdsCell(String(row.관련이벤트 ?? ""))}
      <td class="num">${escapeHtml(
        typeof row.금액영향_원 === "number" ? formatFiat(decimalOf(row.금액영향_원) ?? "0", estimate.currency) : String(row.금액영향_원),
      )}</td>
    </tr>`).join("");

  return `<section class="block">
  <h2>3. 예외 · 판단보류</h2>
  <p class="lead">추가 확인이 필요한 항목입니다. 금액영향은 관련 거래의 원화 금액 합계이며 세금 차이를 뜻하지 않습니다. 가격을 확인하지 못한 거래가 포함되면 <span class="mono">-</span>로 표시합니다.</p>
  <table class="exception">
    <colgroup><col class="c-kind"><col><col class="c-ids"><col class="c-amount"></colgroup>
    <thead><tr><th scope="col">구분</th><th scope="col">내용</th><th scope="col">관련 거래</th><th scope="col" class="num">금액영향</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
  <p class="foot-note">${
    omitted > 0
      ? `예외 ${escapeHtml(rows.length.toLocaleString("ko-KR"))}건 중 ${escapeHtml(shown.length.toLocaleString("ko-KR"))}건을 실었습니다. 나머지 ${escapeHtml(omitted.toLocaleString("ko-KR"))}건과 `
      : "관련 거래의 "
  }전체 목록은 함께 내려받는 XLSX의 <strong>예외</strong> 시트와 CSV 거래 원장에 있습니다.</p>
</section>`;
}

/** 4. 계산 근거와 한계 — 이 문서만 보고 과세를 확정하지 않도록. */
/**
 * 체인에 봉인한 사실. 종이가 스스로 "나는 언제 어느 해시로 고정됐다"고 말해야, 받은 사람이
 * 그 해시로 대조할 수 있다. 값은 전부 서버가 확정한 것이며 여기서 지어내지 않는다.
 */
function anchorBlock(meta: ReportMeta): string {
  if (!meta.anchor) return "";
  const { merkleRoot, txHash, anchoredAt, explorerUrl } = meta.anchor;
  return `<h3>OmniOne 체인 기록</h3>
  <dl class="meta two">
    ${metaRow("머클루트", `<span class="mono">${escapeHtml(merkleRoot)}</span>`, true)}
    ${txHash ? metaRow("거래", `<span class="mono">${escapeHtml(txHash)}</span>`, true) : ""}
    ${anchoredAt ? metaRow("기록 시각", escapeHtml(generatedAtText(anchoredAt))) : ""}
    ${explorerUrl ? metaRow("탐색기", `<span class="mono">${escapeHtml(explorerUrl)}</span>`, true) : ""}
  </dl>
  <p class="foot-note">머클루트는 위 <strong>건별 판정</strong>을 잎으로 묶은 해시입니다. 체인에는 이 해시만 올라가며 금액·지갑 주소는 올라가지 않습니다. 거래 한 건의 판정만 따로 증명할 수도 있습니다.</p>`;
}

function basisSection(estimate: TaxEstimate | null, events: readonly NormalizedEvent[], meta: ReportMeta): string {
  const bases = estimate
    ? [...new Set(estimate.lines.map((line) => line.basis).filter((basis): basis is string => Boolean(basis)))]
    : [];
  // 3절 예외 표가 이미 실은 원장 경고를 메모에 다시 쓰지 않는다(앱 화면·세금 화면과 같은 규칙).
  const notes = estimate ? ruleNotesOf(estimate.notes, estimate.limitations) : [];
  const required = estimate?.requiredInputs ?? [];

  const list = (items: readonly string[]) =>
    `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;

  return `<section class="block">
  <h2>4. 계산 근거와 한계</h2>
  <dl class="meta two">
    ${estimate ? metaRow("적용 계산 기준", escapeHtml(`${estimate.countryLabel} · ${estimate.taxYear}년 귀속`)) : ""}
    ${estimate ? metaRow("취득가액 산정", escapeHtml(estimate.method)) : ""}
    ${estimate ? metaRow("표시 통화", escapeHtml(estimate.currency)) : ""}
    ${metaRow("원장 행 수", `${escapeHtml(events.length.toLocaleString("ko-KR"))}건`)}
    ${bases.length > 0 ? metaRow("근거 조문", escapeHtml(bases.join(" · ")), true) : ""}
  </dl>
  ${anchorBlock(meta)}
  ${required.length > 0 ? `<h3>추가 확인 정보</h3>${list(required)}` : ""}
  ${notes.length > 0 ? `<h3>계산 메모</h3>${list(notes)}` : ""}
  <p class="disclaimer"><strong>이 리포트는 세금 계산을 위한 참고 자료입니다. 실제 신고 금액과 다를 수 있습니다.</strong> 거주국 계산 기준·의제취득가액·거래소 보유분 등에 따라 실제 신고 값은 달라질 수 있습니다. 신고 전 세무 전문가의 확인을 권합니다.</p>
</section>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 조판 — 인쇄(A4)를 1순위로 두고, 화면으로 열렸을 때도 같은 종이처럼 보이게 한다.
// ─────────────────────────────────────────────────────────────────────────────

const STYLE = `
@page { size: A4 portrait; margin: 14mm 13mm 18mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  font-family: "Pretendard", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo",
    "Noto Sans KR", "Malgun Gothic", "맑은 고딕", "Segoe UI", sans-serif;
  font-size: 9.5pt; line-height: 1.55; color: #18181b;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.doc { padding-bottom: 6mm; }

/* 표지 */
.cover { border-bottom: 1.5pt solid #18181b; padding-bottom: 5mm; margin-bottom: 7mm; }
.cover-top { display: flex; align-items: center; justify-content: space-between; gap: 6mm; }
.brand { margin: 0; font-size: 10pt; font-weight: 700; color: #1768d4; letter-spacing: 0.02em; }
.badge { font-size: 8pt; font-weight: 700; border-radius: 999px; padding: 1mm 3mm; white-space: nowrap; }
.badge.ok { background: #eff6ff; color: #1768d4; border: 0.5pt solid #b9dcff; }
.badge.warn { background: #fffbeb; color: #92400e; border: 0.5pt solid #fde68a; }
h1 { margin: 3mm 0 1mm; font-size: 20pt; font-weight: 800; letter-spacing: -0.02em; }
.subtitle { margin: 0 0 5mm; font-size: 10pt; color: #52525b; }

/* 메타 그리드 */
.meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.5mm 8mm; margin: 0; }
.meta.two { margin-top: 1mm; }
.meta-row { display: grid; grid-template-columns: 24mm minmax(0, 1fr); gap: 3mm; align-items: baseline; }
.meta-row.wide { grid-column: 1 / -1; }
.meta dt { font-size: 8.5pt; color: #71717a; }
.meta dd { margin: 0; font-size: 9.5pt; font-weight: 600; color: #27272a; word-break: break-all; }

/* 결론 밴드 */
.headline { margin-top: 5mm; border: 0.75pt solid #b9dcff; background: #f5faff; border-radius: 2mm; padding: 4mm 5mm; }
.headline.empty { border-color: #e4e4e7; background: #fafafa; }
.headline-label { margin: 0; font-size: 8.5pt; font-weight: 700; color: #1768d4; }
.headline.empty .headline-label { color: #71717a; }
.headline-value { margin: 1mm 0 0; font-size: 22pt; font-weight: 800; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.headline-note { margin: 1mm 0 0; font-size: 8.5pt; color: #52525b; }
.assumption { margin: 3mm 0 0; padding-top: 2.5mm; border-top: 0.5pt dashed #b9dcff; font-size: 8.5pt; color: #92400e; }

/* 섹션 */
.block { margin-top: 8mm; break-inside: auto; }
h2 { margin: 0 0 1.5mm; font-size: 12pt; font-weight: 700; padding-bottom: 1.5mm; border-bottom: 0.75pt solid #d4d4d8; break-after: avoid; }
h3 { margin: 4mm 0 1mm; font-size: 9.5pt; font-weight: 700; color: #3f3f46; break-after: avoid; }
.lead { margin: 0 0 3mm; font-size: 8.5pt; color: #71717a; }
.lead .unit { float: right; margin-left: 4mm; font-weight: 600; color: #52525b; }
.empty-note { margin: 2mm 0 0; font-size: 9pt; color: #71717a; }
.foot-note { margin: 2.5mm 0 0; font-size: 8pt; color: #71717a; }
ul { margin: 0; padding-left: 5mm; font-size: 9pt; color: #3f3f46; }
li { margin-bottom: 0.8mm; }

/* 표 공통 */
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
/* 표가 쪽을 넘어가면 머리글이 새 쪽에서 다시 나와야 어느 칸인지 알 수 있다. */
.filing thead, .asset thead, .exception thead { display: table-header-group; }
/* 합계는 표의 끝에 한 번만 — 쪽마다 반복되면 중간 합계로 읽힌다. */
.asset tfoot { display: table-row-group; }
.filing tr, .asset tr, .exception tr { break-inside: avoid; }
th, td { padding: 1.5mm 2mm; text-align: left; vertical-align: top; border-bottom: 0.4pt solid #e4e4e7; }
thead th { background: #f4f4f5; color: #3f3f46; font-size: 8pt; font-weight: 700; border-bottom: 0.75pt solid #a1a1aa; }
tbody th { font-weight: 600; }
.num { text-align: right; white-space: nowrap; }
.neg { color: #b91c1c; }
.mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 8pt; word-break: break-all; }

/* 신고 요약 표 */
.filing .c-label { width: 34mm; }
.filing .c-amount { width: 34mm; }
.filing td.basis { color: #71717a; }
.filing tbody th { font-size: 9.5pt; }
.filing tr.subtract th, .filing tr.subtract td.num { color: #52525b; }
.filing tr.subtotal th, .filing tr.subtotal td.num { font-weight: 700; background: #fafafa; }
.filing tr.note th, .filing tr.note td { font-size: 8.5pt; color: #71717a; border-bottom-style: dashed; }
.filing tr.total th, .filing tr.total td.num { font-weight: 800; font-size: 11pt; color: #1768d4; border-top: 1pt solid #18181b; border-bottom: none; background: #f5faff; }
.filing tr.total td.basis { background: #f5faff; border-top: 1pt solid #18181b; border-bottom: none; }

/* 자산별 명세 표 */
.asset { font-size: 8pt; margin-bottom: 1mm; }
.asset.disposal { font-size: 8.5pt; }
.asset th, .asset td { padding: 1.2mm 1.2mm; }
.asset thead tr.sub th { font-size: 7.5pt; font-weight: 600; background: #fafafa; border-bottom: 0.75pt solid #a1a1aa; }
.asset tbody th { font-weight: 700; }
.asset td.qty { color: #3f3f46; }
/* 마지막 칸은 글자가 적어 표가 좁혀 버린다 — 폭을 못 박지 않으면 "미적용"이 한 글자씩 세로로 쪼개진다. */
.asset .deemed { width: 12mm; text-align: center; font-size: 7.5pt; white-space: nowrap; }
.asset tfoot th, .asset tfoot td { font-weight: 800; background: #f4f4f5; border-top: 0.75pt solid #a1a1aa; border-bottom: none; }

/* 예외 표 */
.exception .c-kind { width: 28mm; }
.exception .c-ids { width: 30mm; }
.exception .c-amount { width: 26mm; }
/* 이벤트 id·해시는 공백이 없어 브라우저가 못 끊는다. 그대로 두면 그 칸이 표를 밀어내고,
   밀려난 다른 칸이 한 글자씩 세로로 쪼개져 한 행이 쪽 하나를 먹는다(실데이터에서 1,899px 관측). */
.exception td, .filing td.basis { font-size: 8.5pt; overflow-wrap: anywhere; }
.exception td.ids .count { display: block; font-size: 8pt; font-weight: 700; color: #3f3f46; }

.disclaimer { margin: 5mm 0 0; padding: 3mm 4mm; border-left: 2pt solid #f59e0b; background: #fffbeb; font-size: 8.5pt; color: #78350f; break-inside: avoid; }

/* 쪽마다 반복되는 바닥글.
   position:fixed는 쪽마다 다시 그려지지만 자리를 예약하지 않아 마지막 줄을 덮는다.
   바깥 표의 tfoot은 반복되면서 그만큼 본문 높이를 줄인다 — 근거자료에서 한 줄이 가려지면 안 된다. */
.frame { width: 100%; border-collapse: collapse; }
.frame > tfoot { display: table-footer-group; }
.frame > tfoot > tr > td, .frame > tbody > tr > td { padding: 0; border: 0; }
.page-foot {
  display: flex; justify-content: space-between; gap: 6mm;
  margin-top: 6mm; padding-top: 2mm; border-top: 0.4pt solid #d4d4d8;
  font-size: 7pt; color: #a1a1aa;
}

/* 화면으로 열렸을 때만 보이는 안내. 인쇄에는 절대 실리지 않는다. */
.screen-only { display: none; }
@media screen {
  body { background: #e4e4e7; padding: 0 0 10mm; }
  .screen-only { display: block; }
  .toolbar {
    position: sticky; top: 0; z-index: 1;
    background: #18181b; color: #fafafa; padding: 3mm 5mm; margin-bottom: 8mm;
    font-size: 9pt; line-height: 1.5;
  }
  .toolbar strong { display: block; font-size: 10pt; margin-bottom: 1mm; }
  .toolbar span { color: #d4d4d8; }
  .doc { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 14mm 13mm 18mm; background: #fff; box-shadow: 0 1mm 4mm rgba(0,0,0,.15); }
  .page-foot { display: none; }
}
@media print { .screen-only { display: none !important; } }
`;

// ─────────────────────────────────────────────────────────────────────────────
// 문서
// ─────────────────────────────────────────────────────────────────────────────

/** 인쇄 대화상자가 기본 파일명으로 쓰는 문서 제목. 저장하면 이 이름의 PDF가 된다. */
export function reportDocumentTitle(estimate: TaxEstimate | null, periodFilePart: string): string {
  return estimate
    ? `verawallet-신고근거-${estimate.taxYear}년귀속-${periodFilePart}`
    : `verawallet-신고근거-${periodFilePart}`;
}

/**
 * 보고서 한 장(독립 HTML 문서)을 만든다. 앱 스타일에 기대지 않으므로 iframe·새 탭·파일 어디서 열어도 같다.
 *
 * `estimate`가 없으면(빈 지갑·계산 실패) 표지와 한계만 있는 문서를 낸다 — 없는 금액을 지어내지 않는다.
 */
export function buildReportHtml(
  events: readonly NormalizedEvent[],
  estimate: TaxEstimate | null,
  meta: ReportMeta,
  periodFilePart = "기간",
): string {
  const filing = estimate ? buildFilingSummary(estimate) : [];
  const title = reportDocumentTitle(estimate, periodFilePart);
  const sections = estimate
    ? [
        filingSection(estimate, filing),
        assetSection(estimate, buildAssetCostDetail(estimate)),
        exceptionSection(estimate, buildExceptions(events, estimate)),
        basisSection(estimate, events, meta),
      ]
    : [basisSection(null, events, meta)];

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="screen-only toolbar">
  <strong>인쇄 대화상자에서 &lsquo;대상 → PDF로 저장&rsquo;을 고르면 이 보고서가 PDF 파일로 저장됩니다.</strong>
  <span>대화상자가 닫혔다면 Ctrl+P(맥은 &#8984;+P)로 다시 열 수 있습니다. &lsquo;배경 그래픽&rsquo;을 켜면 표 머리글 음영까지 그대로 인쇄됩니다.</span>
</div>
<table class="frame">
<tfoot><tr><td><footer class="page-foot">
  <span>${escapeHtml(title)}</span>
  <span>VeraWallet · ${escapeHtml(generatedAtText(meta.generatedAt))} 작성 · 계산 보조용</span>
</footer></td></tr></tfoot>
<tbody><tr><td>
<main class="doc">
${cover(events, estimate, meta, filing)}
${sections.join("\n")}
</main>
</td></tr></tbody>
</table>
</body>
</html>`;
}
