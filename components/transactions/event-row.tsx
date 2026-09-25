import { ValueText } from "@/components/ui/value-text";
import { TransactionLogo } from "@/components/transactions/transaction-logo";
import { TransactionTypeBadge } from "@/components/transactions/transaction-type-badge";
import { assetTicker, chainLabel, formatFiat, formatSignedTokenAmount } from "@/lib/format";
import { div, isNegative, isPositive, isZero, mul, round, sum } from "@/lib/tax/decimal";
import type { EventRecord } from "@/lib/transactions/types";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { JudgmentRow } from "@/lib/tax/types";

/**
 * 손익 판정 행에서 합산한 **실현 손익 금액**. 상세의 "손익은 이렇게 나왔습니다" 근거표가 쓰는 것과
 * **같은 소스**(amountKind==="gain")라 목록과 상세가 갈리지 않는다. 손익 판정이 없는 건
 * (NFT·수령분·자기 지갑 간 이체·보류·중복·제외로 rows가 빔)은 null → 목록은 "—"로 둔다.
 * 세무 엔진을 다시 돌리지 않고 이미 계산된 값을 합칠 뿐이다.
 */
export function gainAmount(rows: JudgmentRow[]): string | null {
  const gainRows = rows.filter((row) => row.amountKind === "gain");
  if (gainRows.length === 0) return null;
  return sum(gainRows.map((row) => row.amount));
}

/**
 * 손익 판정 행에서 뽑은 수익률(%). 손익 금액과 **같은 소스**(judgment gain 행)를 쓰므로 목록·상세가 갈리지 않는다.
 * 이미 계산된 값(손익/취득가액)을 표시 산술로 나눌 뿐이다. 원가를 알 수 없으면(취득가 0·근거 없음) null.
 */
export function gainReturnPercent(rows: JudgmentRow[]): string | null {
  const gainRows = rows.filter((row) => row.amountKind === "gain" && row.breakdown !== undefined);
  if (gainRows.length === 0) return null;
  const gainSum = sum(gainRows.map((row) => row.amount));
  const costSum = sum(gainRows.map((row) => row.breakdown!.cost));
  if (isZero(costSum)) return null;
  return round(div(mul(gainSum, "100"), costSum), 2);
}

export function EventRow({
  record,
  onSelect,
  rows,
  currency,
  isExcluded,
  inPeriod,
  isDuplicate,
  hideBalances,
  swapInLeg,
  isFirstNew,
}: {
  record: EventRecord;
  /** 없으면 **보기 전용** 행이다(스팸 목록). 열 상세가 없는 행을 버튼으로 두면 눌러도 아무 일이 없다. */
  onSelect?: () => void;
  rows: JudgmentRow[];
  /** 손익을 그릴 통화(estimate와 같은 소스). rows가 비면 손익도 없어 통화는 쓰이지 않는다. */
  currency: string;
  isExcluded: boolean;
  inPeriod: boolean | null;
  isDuplicate: boolean;
  /** 잔액 가리기 모드. 수량은 가리되 자산 심볼·배지·건수는 정보로 남긴다. */
  hideBalances?: boolean;
  /** 스왑의 받은(IN) 다리 — 같은 tx_hash 페어. 있으면 이 행이 두 다리를 한 줄로 말한다. */
  swapInLeg?: NormalizedEvent | null;
  /** 이번 불러오기로 들어온 **첫** 거래인가. 완료 알림의 "보러 가기"가 찾아올 자리다. */
  isFirstNew?: boolean;
}) {
  const { event } = record;
  // 손익·수익률은 상세와 같은 판정 손익 행에서만 나온다 — 보류·중복·제외 때는 rows가 비어 자연히 null이 된다.
  const gain = gainAmount(rows);
  const returnPercent = gainReturnPercent(rows);
  // 카드는 이벤트 id로 식별한다. 금액 라벨은 유효 분류에 따라 부호가 뒤집히므로(재분류 후 +0.01 → -0.01)
  // 그걸 식별자로 쓰면 "방금 고친 카드"를 다시 찾지 못한다.
  // 한 줄 레이아웃 — 왼쪽: 로고(체인은 코너 배지)·거래 타입·티커 / 오른쪽: 손익·수익률.
  const rowClass = "flex min-w-0 flex-wrap items-center gap-3 rounded-card border border-zinc-200 bg-white px-4 py-3 text-left shadow-card";

  const body = (
    <>
      {/* 왼쪽 로고 클러스터. 체인 이름은 텍스트로 쓰지 않고 로고만 코너 배지로 얹는다.
          스왑은 두 자산 로고, 브릿지는 두 체인 배지로 그린다. */}
      <TransactionLogo event={event} swapInLeg={swapInLeg} />
      <div className="flex min-w-0 flex-[1_1_4rem] flex-col gap-1">
        <TransactionTypeBadge event={event} />
        {/* 티커 줄. e2e·테스트가 이 속성으로 행을 집으므로 레이아웃이 바뀌어도 유지한다.
            스왑 페어는 "−보낸 수량 → +받은 수량"(얼마를 얼마만큼), 같은 자산 브릿지는 부호 없는 수량과 티커,
            NFT는 개체 번호 없이 티커만, 그 밖은 부호 붙은 수량과 티커를 함께 보인다. 체인은 브릿지도 포함해
            텍스트로 쓰지 않는다 — 출발·도착은 왼쪽 로고의 체인 배지 두 개가 말하고, 스크린리더용 sr-only만 남긴다. */}
        <span data-event-label className="mt-0.5 block truncate text-[0.8125rem] text-zinc-500">
          {swapInLeg ? (
            <>
              <span className="text-rose-700"><ValueText>{hideBalances ? "•••••" : `${formatSignedTokenAmount(event)} ${assetTicker(event)}`}</ValueText></span>
              <span className="text-zinc-400"> → </span>
              <span className="text-emerald-700"><ValueText>{hideBalances ? "•••••" : `${formatSignedTokenAmount(swapInLeg)} ${assetTicker(swapInLeg)}`}</ValueText></span>
            </>
          ) : event.swap_to_symbol !== null
            ? `${assetTicker(event)} → ${event.swap_to_symbol}`
            : event.bridge_dest_chain_id !== null
              ? `${hideBalances ? "•••••" : formatSignedTokenAmount(event)} ${assetTicker(event)}`
              : event.token_id !== null
                ? assetTicker(event)
                : `${hideBalances ? "•••••" : formatSignedTokenAmount(event)} ${assetTicker(event)}`}
        </span>
        {/* 체인은 시각적으로 코너 로고 배지로만 보이므로(체인 이름 텍스트 제거), 스크린리더에는
            체인명을 sr-only로 남겨 어느 체인의 자산인지 잃지 않게 한다. 브릿지는 출발·도착을 함께 읽어준다. */}
        <span className="sr-only">
          {event.bridge_dest_chain_id === null
            ? chainLabel(event.chain_id)
            : `${chainLabel(event.chain_id)} → ${chainLabel(event.bridge_dest_chain_id)}`}
        </span>
      </div>
      {/* 오른쪽 칸은 방향과 무관하게 같은 뜻을 가진다.
          1줄: **거래 당시 평가액**(이벤트 통화 그대로). 수량 줄의 −/+는 지갑 기준 방향이고, 이 줄은 그 수량의 가치라
          부호·색 없이 중립으로 둔다. 가격 미확인이면 "-". 손익을 이 자리에 두면 "-563 USDC / -₩33,767"처럼
          방향 부호와 손익 부호가 한 행에 섞여 3만 원어치를 보냈다고 읽힌다(실제 가치는 77만 원).
          2줄: **실현 손익**(처분 행에만). 상세의 손익 근거표와 같은 판정 행(amountKind==="gain")을 합산하므로
          목록과 상세가 갈리지 않는다. 눈에 보이는 라벨을 붙여 1줄의 평가액과 뜻이 섞이지 않게 하고,
          상승은 receive(녹)·하락은 dispose(적) 토큰을 쓰되 색만으로 못 가르는 사용자를 위해 부호를 함께 둔다.
          판정이 아직 오지 않았으면(보류) 오른쪽을 비운다 — 손익 블록의 유무가 곧 정착 신호다.
          배지(판정 도장·미검증·확인 필요 등)는 목록이 아니라 거래 상세에서만 말한다.
          금액 열은 기본적으로 행 너비의 62%를 사용한다. 공간이 부족하면 다음 줄로 이동하며,
          긴 금액은 전체 값을 유지한 채 줄바꿈한다. 왼쪽 수량 요약은 상세 화면에서 확인할 수 있다. */}
      {isExcluded || isDuplicate || inPeriod !== null ? (
        <div data-surface="event-gain" className="ml-auto flex min-w-0 max-w-full flex-[0_1_62%] flex-col items-end text-right">
          <span className="text-xs font-normal text-zinc-500">거래 당시 평가액</span>
          {event.fiat_value !== null ? (
            <span className="text-[0.9375rem] font-bold tabular-nums text-zinc-900">
              <ValueText>{hideBalances ? "•••••" : formatFiat(event.fiat_value, event.fiat_currency)}</ValueText>
            </span>
          ) : (
            <span className="text-[0.9375rem] font-bold tabular-nums text-zinc-400">-</span>
          )}
          {gain !== null ? (
            hideBalances ? (
              <span className="mt-0.5 text-[0.8125rem] tabular-nums text-zinc-500">
                <span className="text-zinc-400">실현 손익 </span>•••••
              </span>
            ) : (
              <span className={`mt-0.5 text-[0.8125rem] font-semibold tabular-nums ${isPositive(gain) ? "text-receive" : isNegative(gain) ? "text-dispose" : "text-zinc-500"}`}>
                <span className="font-normal text-zinc-400">실현 손익 </span>
                <span className="inline-block max-w-full whitespace-normal wrap-anywhere">{isPositive(gain) ? "+" : ""}<ValueText>{formatFiat(gain, currency)}</ValueText></span>
                {returnPercent !== null ? (
                  <span className="inline-block max-w-full whitespace-normal wrap-anywhere font-normal text-zinc-400"> (<span className="sr-only">수익률 </span>{isPositive(returnPercent) ? "+" : ""}{returnPercent}%)</span>
                ) : null}
              </span>
            )
          ) : null}
        </div>
      ) : null}
    </>
  );

  // 보기 전용 행은 버튼이 아니다 — 눌러도 열 것이 없는 버튼은 키보드·스크린리더 사용자에게
  // 막다른 길이 되고, 탭 순서에서 아무 일도 하지 않는 자리를 하나씩 차지한다.
  if (onSelect === undefined) {
    return (
      <div data-event-id={event.id} className={rowClass}>
        {body}
      </div>
    );
  }

  return (
    <button data-event-id={event.id} data-new-event={isFirstNew ? "true" : undefined} type="button" className={`${rowClass} active:bg-zinc-50`} onClick={onSelect}>
      {body}
    </button>
  );
}
