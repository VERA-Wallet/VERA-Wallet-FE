import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MockProvenanceChip, ProvenanceChip } from "@/components/ui/provenance-chip";

describe("출처 배지", () => {
  it("mock이면 예전 그대로 'mock 데이터'를 같은 testid로 그린다 — AC6 e2e 계약이 이 글자를 본다", () => {
    render(<ProvenanceChip provenance="mock" />);
    expect(screen.getByTestId("mock-provenance")).toHaveTextContent("예제 데이터");
  });

  it("live면 '실데이터'라고 말한다 — 실모드에서 화면이 mock이라고 거짓말하지 않게", () => {
    render(<ProvenanceChip provenance="live" />);
    expect(screen.getByTestId("live-provenance")).toHaveTextContent("실데이터");
    expect(screen.queryByTestId("mock-provenance")).toBeNull();
  });

  it("출처를 모르면 mock으로 본다 — 실데이터라고 주장하는 쪽이 더 위험하다", () => {
    render(<ProvenanceChip />);
    expect(screen.getByTestId("mock-provenance")).toBeInTheDocument();
  });

  it("기능 자체가 mock인 표면용 별칭은 모드와 무관하게 mock이다", () => {
    render(<MockProvenanceChip />);
    expect(screen.getByTestId("mock-provenance")).toBeInTheDocument();
  });
});
