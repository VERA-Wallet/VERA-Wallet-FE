import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";

/**
 * 지갑 미연결 대시보드 껍데기 — 건너뛴 사용자가 돌아올 집.
 *
 * 옛 문구는 내부 인증 용어("클레임")를 그대로 노출했고, 제목은 목록이 거래 탭으로 떠난 뒤에도
 * "거래 요약"에 머물러 있었다. 이 파일이 지키는 것은 사용자가 아는 말로 바뀌었는가, 그리고
 * 주 CTA가 실제로 데이터를 불러오는 행동(지갑 연결)을 가리키는가다.
 */
describe("빈 요약", () => {
  it("제목이 '요약'이고 거주국을 사용자 말로 보이며 '클레임'을 쓰지 않는다", () => {
    render(<DashboardEmptyState countryCode="KR" />);

    expect(screen.getByRole("heading", { level: 1, name: "요약" })).toBeInTheDocument();
    expect(screen.getByText("거주 국가: 한국")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("클레임");
  });

  it("룰셋에 없는 국가 코드는 지어내지 않고 코드 그대로 보인다", () => {
    render(<DashboardEmptyState countryCode="ZZ" />);
    expect(screen.getByText("거주 국가: ZZ")).toBeInTheDocument();
  });

  it("국가 코드가 없으면 확인하지 못했다고 말한다", () => {
    render(<DashboardEmptyState />);
    expect(screen.getByText("거주 국가를 확인하지 못했습니다.")).toBeInTheDocument();
  });

  it("주 CTA는 '지갑 연결하기'라 부르고 지갑 연결 페이지로 보낸다", () => {
    render(<DashboardEmptyState countryCode="KR" />);
    const primary = screen.getByRole("link", { name: "지갑 연결하기" });
    expect(primary).toHaveAttribute("href", "/connect-wallet");
    // 본문 문구의 "내보내기"는 이제 "리포트"라 부른다(탭 이름과 맞춘다).
    expect(document.body.textContent ?? "").toContain("요약·판정·리포트");
    expect(document.body.textContent ?? "").not.toContain("내보내기");
  });

  it("보조 CTA와 자리 표시자 구조는 그대로 남는다", () => {
    render(<DashboardEmptyState countryCode="KR" />);
    expect(screen.getByRole("link", { name: "데모 데이터로 둘러보기" })).toHaveAttribute("href", "/export");
    expect(screen.getByText("예상 손익")).toBeInTheDocument();
    expect(screen.getByText("계산 대상 이벤트")).toBeInTheDocument();
  });
});
