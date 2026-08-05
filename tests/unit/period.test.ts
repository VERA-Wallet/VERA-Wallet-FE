import { describe, expect, it } from "vitest";
import { halfOpenPeriodLabel, isGroundedPeriod, isoDay, periodFilePart, periodLabel } from "@/lib/period";

describe("기간 표시는 있는 기간만 말한다", () => {
  const cases: { from: string; to: string; label: string; file: string; why: string }[] = [
    { from: "", to: "", label: "기간 미정", file: "기간미정", why: "빈 지갑" },
    { from: "2025-01-01T00:00:00.000Z", to: "", label: "기간 미정", file: "기간미정", why: "한쪽만 있음" },
    { from: "2025", to: "2025", label: "기간 미정", file: "기간미정", why: "연도만 — Date.parse는 통과시킨다" },
    { from: "2025-01", to: "2025-02", label: "기간 미정", file: "기간미정", why: "연월만" },
    { from: "2025-02-30", to: "2025-03-31", label: "기간 미정", file: "기간미정", why: "달력에 없는 날짜" },
    { from: "not-a-date", to: "2025-03-31", label: "기간 미정", file: "기간미정", why: "날짜가 아님" },
    {
      from: "2025-01-01T00:00:00.000Z",
      to: "2025-01-26T00:00:00.000Z",
      label: "2025-01-01 ~ 2025-01-26",
      file: "2025-01-01_2025-01-26",
      why: "정상 RFC3339",
    },
    { from: "2024-02-29", to: "2024-03-01", label: "2024-02-29 ~ 2024-03-01", file: "2024-02-29_2024-03-01", why: "윤년 2월 29일" },
  ];

  for (const { from, to, label, file, why } of cases) {
    it(`${why}: ${JSON.stringify({ from, to })}`, () => {
      expect(periodLabel({ from, to })).toBe(label);
      expect(periodFilePart({ from, to })).toBe(file);
    });
  }

  it("파일명에 빈 조각(-_.)을 만들지 않는다", () => {
    expect(periodFilePart({ from: "", to: "" })).not.toContain("_");
  });
});

describe("표시 판정과 계산 근거 판정이 같은 규칙을 쓴다", () => {
  const invalid = [
    { from: "", to: "" },
    { from: "2025", to: "2025-12-31" },
    { from: "2025-02-30", to: "2025-03-31" },
    { from: "2025-13-01", to: "2025-12-31" },
    { from: "2025-01-00", to: "2025-12-31" },
    { from: "2025-01-01T00:00:00.000Z", to: "" },
  ];
  for (const period of invalid) {
    it(`${JSON.stringify(period)}는 표시도 계산 근거도 아니다`, () => {
      // 둘이 갈리면 헤더는 "기간 미정"인데 판정 기준은 "2025년 세금"을 말한다.
      expect(periodLabel(period)).toBe("기간 미정");
      expect(periodFilePart(period)).toBe("기간미정");
      expect(isGroundedPeriod(period)).toBe(false);
    });
  }

  it("정상 기간은 표시도 되고 계산 근거도 된다", () => {
    const period = { from: "2025-01-01T00:00:00.000Z", to: "2025-01-26T00:00:00.000Z" };
    expect(periodLabel(period)).toBe("2025-01-01 ~ 2025-01-26");
    expect(isGroundedPeriod(period)).toBe(true);
  });

  it("잘못된 월·일은 예외를 던지지 않는다", () => {
    expect(() => periodLabel({ from: "2025-13-01", to: "2025-00-31" })).not.toThrow();
    expect(isoDay("2025-13-01")).toBe("");
    expect(isoDay("2025-01-00")).toBe("");
  });
});

describe("접두사만 보고 통과시키지 않는다", () => {
  const malformed = [
    "2025-01-01T00:00:00+25:00",
    "2025-01-01T99:00:00.000Z",
    "2025-01-01T00:00:00.000ZZZ",
    "2025-01-01쓰레기",
  ];
  for (const value of malformed) {
    it(`${value}는 근거가 아니다`, () => {
      // 앞 10자리는 멀쩡해도 전체가 파싱되지 않으면 taxYearFor가 NaN을 낸다.
      expect(isoDay(value)).toBe("");
      expect(isGroundedPeriod({ from: value, to: "2025-12-31" })).toBe(false);
      expect(periodLabel({ from: value, to: "2025-12-31" })).toBe("기간 미정");
      expect(periodFilePart({ from: value, to: "2025-12-31" })).toBe("기간미정");
    });
  }

  it("유효한 시간대 오프셋은 그대로 통과한다", () => {
    expect(isoDay("2025-01-01T23:00:00+09:00")).toBe("2025-01-01");
    expect(isGroundedPeriod({ from: "2025-01-01T23:00:00+09:00", to: "2025-12-31" })).toBe(true);
  });

  it("ASCII 4자리 연도가 아니면 거부한다", () => {
    expect(isoDay("２０２５-01-01")).toBe("");
    expect(isoDay("-025-01-01")).toBe("");
    expect(isoDay("025-01-01")).toBe("");
  });
});

describe("끝이 시작보다 앞선 기간은 기간이 아니다", () => {
  it("역순 기간은 표시도 계산 근거도 아니다", () => {
    const reversed = { from: "2025-12-31", to: "2025-01-01" };
    expect(isGroundedPeriod(reversed)).toBe(false);
    expect(periodLabel(reversed)).toBe("기간 미정");
    expect(periodFilePart(reversed)).toBe("기간미정");
  });
});

describe("기간 순서는 날짜가 아니라 실제 시각으로 본다", () => {
  it("같은 날짜라도 시간대 때문에 역순이면 거부한다", () => {
    // 23:00+09:00 = 14:00Z 이므로 00:00Z보다 뒤다. 날짜만 보면 둘 다 2025-01-01이라 놓친다.
    const reversed = { from: "2025-01-01T23:00:00+09:00", to: "2025-01-01T00:00:00.000Z" };
    expect(isGroundedPeriod(reversed)).toBe(false);
    expect(periodLabel(reversed)).toBe("기간 미정");
    expect(periodFilePart(reversed)).toBe("기간미정");
  });

  it("같은 날 00:00 → 23:59는 정상이다", () => {
    const sameDay = { from: "2025-01-01T00:00:00.000Z", to: "2025-01-01T23:59:59.000Z" };
    expect(isGroundedPeriod(sameDay)).toBe(true);
    expect(periodLabel(sameDay)).toBe("2025-01-01 ~ 2025-01-01");
  });

  it("시간대가 섞여도 실제 순서가 맞으면 통과한다", () => {
    const ok = { from: "2025-01-01T00:00:00.000Z", to: "2025-01-02T09:00:00+09:00" };
    expect(isGroundedPeriod(ok)).toBe(true);
    expect(periodLabel(ok)).toBe("2025-01-01 ~ 2025-01-02");
  });
});

describe("반열린 과세기간 표기", () => {
  it("포함하지 않는 끝을 하루 당겨 보인다", () => {
    // 엔진의 to는 배타적이다. 그대로 찍으면 하루 넓은 기간을 말하게 된다.
    expect(halfOpenPeriodLabel({ from: "2025-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" })).toBe(
      "2025-01-01 ~ 2025-12-31",
    );
  });

  it("영국 4/6~ 비역년 기간도 정확히 접는다", () => {
    expect(halfOpenPeriodLabel({ from: "2025-04-06T00:00:00.000Z", to: "2026-04-06T00:00:00.000Z" })).toBe(
      "2025-04-06 ~ 2026-04-05",
    );
  });

  it("호주 7/1~ 비역년 기간도 정확히 접는다", () => {
    // 월과 연이 함께 넘어가는 경계다. 하루 당기기가 어긋나면 6/30이 7/1이 된다.
    expect(halfOpenPeriodLabel({ from: "2025-07-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z" })).toBe(
      "2025-07-01 ~ 2026-06-30",
    );
  });

  it("윤년 3월 1일 경계에서 2월 29일로 접는다", () => {
    expect(halfOpenPeriodLabel({ from: "2023-03-01T00:00:00.000Z", to: "2024-03-01T00:00:00.000Z" })).toBe(
      "2023-03-01 ~ 2024-02-29",
    );
  });

  it("기간이 성립하지 않으면 단정하지 않는다", () => {
    expect(halfOpenPeriodLabel({ from: "2026-01-01", to: "2025-01-01" })).toBe("기간 미정");
    expect(halfOpenPeriodLabel({ from: "", to: "" })).toBe("기간 미정");
  });
})
