import type { Provenance } from "@/lib/http/envelope";

/**
 * 데이터 출처 배지. mock이면 "mock 데이터", live면 "실데이터".
 *
 * 예전 `MockProvenanceChip`은 글자를 하드코딩해서, BE·신원인증을 실모드로 바꿔도 화면이 계속 "mock 데이터"라고
 * 말했다. 출처는 세 갈래에서 온다: 응답에 실린 `provenance`(estimate·holdings), 서버 페이지가 계산해 내려주는
 * API/신원 모드(`lib/api-mode.ts`), 그리고 기능 자체가 mock인 곳(결제·거래소 연동)의 고정값.
 * 기본값이 mock인 이유: 출처를 모르는 표면이 실데이터라고 주장하는 쪽이 더 위험하다.
 */
export function ProvenanceChip({ provenance = "mock" }: { provenance?: Provenance }) {
  if (provenance === "live") {
    return (
      <span data-testid="live-provenance" className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
        실데이터
      </span>
    );
  }
  return (
    <span data-testid="mock-provenance" className="inline-flex rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500">
      mock 데이터
    </span>
  );
}

/** 기능 자체가 아직 mock인 표면(mock 결제, 거래소 연동 준비중)용. 모드와 무관하게 mock이다. */
export function MockProvenanceChip() {
  return <ProvenanceChip provenance="mock" />;
}
