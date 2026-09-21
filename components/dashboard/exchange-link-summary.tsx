"use client";

import { ExchangeMark } from "@/components/ui/exchange-mark";
import { MockProvenanceChip } from "@/components/ui/provenance-chip";
import { exchangeById } from "@/lib/exchange/mock-links";
import { useExchangeLinks } from "@/lib/exchange/use-exchange-links";

/**
 * 온보딩에서 연동한 거래소를 대시보드에서 다시 보여 준다.
 *
 * 연동해 놓고 어디에도 흔적이 없으면 사용자는 연동이 풀렸다고 읽는다.
 * 동시에 **아래 거래 목록은 여전히 지갑 이벤트뿐**이라는 사실을 같은 자리에서 말해야 한다 —
 * 거래소 배지만 띄우고 목록이 그대로면 화면이 "가져왔다"고 거짓말하는 셈이다.
 *
 * 연동이 하나도 없으면 아무것도 그리지 않는다(빈 카드는 자리만 차지한다).
 */
export function ExchangeLinkSummary({ storage }: { storage?: Storage | null } = {}) {
  const [links] = useExchangeLinks(storage);

  if (links.length === 0) return null;

  return (
    <section
      data-surface="exchange-link-summary"
      aria-label="연동된 거래소"
      className="mt-4 rounded-card border border-zinc-200 bg-white px-4 py-3 shadow-card"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-zinc-900">거래소 연동 {links.length}곳</p>
        <MockProvenanceChip />
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {links.map((link) => {
          const exchange = exchangeById(link.exchangeId);
          if (!exchange) return null;
          return (
            <li
              key={link.exchangeId}
              className="flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600"
            >
              <ExchangeMark exchange={exchange} size={16} />
              {exchange.name}
              <span className="text-zinc-400">조회 전용</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        연동 흐름만 시연한 상태라 아래 목록에는 거래소 거래가 아직 들어오지 않습니다.
      </p>
    </section>
  );
}
