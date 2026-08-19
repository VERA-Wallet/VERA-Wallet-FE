import { Card } from "@/components/ui/card";
import { ExchangeMark } from "@/components/ui/exchange-mark";
import { EXCHANGES } from "@/lib/exchange/mock-links";

/**
 * 거래소 연동 — MVP에서는 "곧 지원" 안내만 한다.
 *
 * 실제 파이프라인(조회 전용 키/OAuth로 체결·입출금을 지갑 이벤트와 같은 스키마로 정규화)은 아직 없다.
 * 되는 척하는 입력 폼을 두면 사용자가 연동됐다고 오해하므로, 지원 예정 거래소 목록만 흐리게 보여주고
 * 상호작용은 막는다. 데이터를 실제로 불러오는 경로는 지금은 지갑(EOA) 연결뿐이다.
 */
export function ExchangeComingSoon() {
  return (
    <Card className="mt-4">
      <div data-surface="exchange-coming-soon" className="flex items-center justify-between">
        <p className="font-semibold text-zinc-900">거래소 계정 연동</p>
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-500">곧 지원</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        지갑 밖 거래소 거래도 함께 보는 기능은 준비 중입니다. 지금은 지갑 연결로 온체인 거래를 불러옵니다.
      </p>
      <ul aria-label="지원 예정 거래소" className="mt-4 divide-y divide-zinc-100 border-t border-zinc-100 opacity-60">
        {EXCHANGES.map((exchange) => (
          <li key={exchange.id} className="flex items-center gap-3 py-3">
            <ExchangeMark exchange={exchange} />
            <p className="min-w-0 flex-1 font-semibold text-zinc-500">{exchange.name}</p>
            <span className="shrink-0 text-xs font-medium text-zinc-400">준비 중</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
