import { ChainIcon } from "@/components/ui/chain-icon";
import {
  chainScanState,
  importProgressPercent,
  type ChainScanState,
  type ImportProgress,
  type ScanChain,
} from "@/lib/wallet/import-progress";

/**
 * 체인별 조회 상태 목록과 진행 막대. 모달과 진행 시트가 **같은 것을 보여줘야 하므로** 한 곳에서 그린다 —
 * 각자 그리면 같은 작업을 두 화면이 다른 진척으로 말하게 된다.
 */

/** 체인 한 줄의 조회 상태. 아이콘이 아니라 **글자**로 말한다 — 체인 마크가 이미 옆에 있어 표식을 또 그리면 두 원이 헷갈린다. */
function ChainScanMark({ state }: { state: ChainScanState }) {
  if (state === "done") return <span className="text-xs font-semibold text-primary-600">완료</span>;
  if (state === "failed") return <span className="text-xs font-semibold text-red-700">실패</span>;
  if (state === "scanning") return <span className="text-xs font-semibold text-zinc-600">조회 중</span>;
  return <span className="text-xs text-zinc-400">대기</span>;
}

/**
 * `progress`를 주지 않으면 **체인별 사실을 모른다**는 뜻이다. 그때는 전부 "조회 중"으로 둔다 —
 * 모르는 상태를 완료로 그리면 아직 훑는 중인 체인을 끝났다고 말하게 되고, 대기로 그리면 멈춘 것처럼 보인다.
 */
export function ImportChainList({ progress = null, chains }: { progress?: ImportProgress | null; chains: ScanChain[] }) {
  return (
    <ul className="space-y-2 rounded-xl bg-zinc-50 px-3 py-2.5" aria-label="조회할 체인">
      {chains.map((chain, index) => {
        const state = progress === null ? "scanning" : chainScanState(progress, index);
        return (
          <li key={chain.chainId} className="flex items-center gap-2">
            <ChainIcon chainId={chain.chainId} size={18} />
            <span className={`text-sm font-semibold ${state === "pending" ? "text-zinc-400" : "text-zinc-900"}`}>
              {chain.chainName}
            </span>
            {/* 수집 건수는 응답이 온 뒤에만 안다. 모르는 동안 0을 그리면 "이 체인엔 아무것도 없다"로 읽힌다. */}
            {chain.txCount !== undefined ? <span className="text-xs text-zinc-400">거래 {chain.txCount}건</span> : null}
            <span className="ml-auto">
              <ChainScanMark state={state} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 막대는 **완료한 단계 수**에서 나온 값이라 실제 상태를 꽂아도 그대로 맞는다.
 * 색만으로 말하지 않도록 곁의 체인·단계 목록이 같은 사실을 글자로 반복한다.
 *
 * `progress`가 없으면 진척을 모르는 것이다. 0%로 멈춘 막대는 "아무 일도 일어나지 않는다"로 읽히므로
 * 대신 왕복하는 막대를 쓴다 — 진행률이 아니라 **살아 있다는 사실**만 말한다.
 */
export function ImportProgressBar({ progress = null }: { progress?: ImportProgress | null }) {
  if (progress === null) {
    return (
      <div aria-hidden="true" data-progress="indeterminate" className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        {/* 움직임을 끈 사용자에게는 왕복이 보이지 않는다 — 그때는 옅은 막대로 남겨 자리를 지킨다. */}
        <div className="h-full w-1/3 animate-import-sweep rounded-full bg-primary-500 motion-reduce:w-full motion-reduce:animate-none motion-reduce:bg-primary-200" />
      </div>
    );
  }
  return (
    <div aria-hidden="true" data-progress="determinate" className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${progress.phase === "failed" ? "bg-red-400" : "bg-primary-500"}`}
        style={{ width: `${importProgressPercent(progress)}%` }}
      />
    </div>
  );
}
