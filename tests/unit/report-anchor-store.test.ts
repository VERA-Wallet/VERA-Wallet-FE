import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getMockReportAnchor,
  mockReportAnchorCount,
  mockReportAnchorFailing,
  registerMockReportAnchor,
  resetMockReportAnchors,
  setMockReportAnchorFailure,
} from "@/lib/mock/report-anchor-store";
import type { ReportAnchorInput, ReportAnchorKey } from "@/lib/ports/report-anchor";

/**
 * `evidence-store.ts`와 달리 이 저장소는 전이(pending → anchored/failed)·실패·재시도를 다룬다
 * (계획 §0-F2). 저장소는 `Date.now()`를 직접 읽으므로 vitest fake timers가 그대로 시계를 흉내 낸다.
 */

const USER = "0xabc";

function input(overrides: Partial<ReportAnchorInput> = {}): ReportAnchorInput {
  return {
    version: 1,
    algorithm: "keccak256",
    fileHash: `0x${"a".repeat(64)}`,
    kind: "csv",
    countryCode: "KR",
    taxYear: 2027,
    byteLength: 1234,
    ...overrides,
  };
}

function keyOf(i: ReportAnchorInput): ReportAnchorKey {
  return { fileHash: i.fileHash, kind: i.kind, countryCode: i.countryCode, taxYear: i.taxYear };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2027-05-01T00:00:00.000Z"));
});

afterEach(() => {
  resetMockReportAnchors();
  setMockReportAnchorFailure(false);
  vi.useRealTimers();
});

describe("registerMockReportAnchor: pending → anchored 전이", () => {
  it("등록 즉시는 pending이고, 지연이 지나야 anchored로 정착한다", () => {
    const record = registerMockReportAnchor(USER, input());
    expect(record.anchorStatus).toBe("pending");
    expect(record.attempt).toBe(1);
    expect(record.txHash).toBeNull();
    expect(record.blockNumber).toBeNull();
    expect(record.anchoredAt).toBeNull();

    vi.advanceTimersByTime(1_199);
    expect(getMockReportAnchor(USER, keyOf(input()))?.anchorStatus).toBe("pending");

    vi.advanceTimersByTime(1);
    const anchored = getMockReportAnchor(USER, keyOf(input()));
    expect(anchored?.anchorStatus).toBe("anchored");
    expect(anchored?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(anchored?.blockNumber).not.toBeNull();
    expect(anchored?.anchoredAt).toBe("2027-05-01T00:00:01.200Z");
    expect(anchored?.failureReason).toBeNull();
    expect(anchored?.lastFailureAt).toBeNull();
  });
});

describe("registerMockReportAnchor: 멱등", () => {
  it("pending 상태에 재등록하면 같은 시도를 그대로 돌려준다(트랜잭션 중복 없음)", () => {
    const first = registerMockReportAnchor(USER, input());
    const second = registerMockReportAnchor(USER, input());
    expect(second.attempt).toBe(1);
    expect(second.anchorStatus).toBe("pending");
    expect(second.recordedAt).toBe(first.recordedAt);
  });

  it("anchored 상태에 재등록해도 같은 기록을 그대로 돌려준다(새 트랜잭션 없음)", () => {
    registerMockReportAnchor(USER, input());
    vi.advanceTimersByTime(1_200);
    const anchored = registerMockReportAnchor(USER, input());
    expect(anchored.anchorStatus).toBe("anchored");
    expect(anchored.attempt).toBe(1);
    const txHash = anchored.txHash;

    const again = registerMockReportAnchor(USER, input());
    expect(again.txHash).toBe(txHash);
    expect(again.attempt).toBe(1);
  });
});

describe("registerMockReportAnchor: failed → pending 재제출", () => {
  it("실패로 정착한 뒤 재등록하면 attempt가 오르고 새 시도가 pending으로 열린다", () => {
    setMockReportAnchorFailure(true);
    registerMockReportAnchor(USER, input());
    vi.advanceTimersByTime(1_200);
    const failed = getMockReportAnchor(USER, keyOf(input()));
    expect(failed?.anchorStatus).toBe("failed");
    expect(failed?.attempt).toBe(1);
    expect(failed?.failureReason).not.toBeNull();
    expect(failed?.lastFailureAt).not.toBeNull();

    // 실패 스위치를 끄고 재제출한다.
    setMockReportAnchorFailure(false);
    const retried = registerMockReportAnchor(USER, input());
    expect(retried.attempt).toBe(2);
    expect(retried.anchorStatus).toBe("pending");
    // 직전 실패는 사실이다 — pending으로 되돌아간 뒤에도 남는다.
    expect(retried.failureReason).not.toBeNull();
    expect(retried.lastFailureAt).not.toBeNull();

    vi.advanceTimersByTime(1_200);
    const anchored = getMockReportAnchor(USER, keyOf(input()));
    expect(anchored?.anchorStatus).toBe("anchored");
    expect(anchored?.attempt).toBe(2);
    // 시도가 anchored로 정착해도 마지막 실패 사유는 지워지지 않는다 — 재시도 중에도 사실이다.
    expect(anchored?.failureReason).not.toBeNull();
  });

  it("재시도한 트랜잭션 해시는 첫 시도와 다르다(attempt가 preimage에 들어간다)", () => {
    setMockReportAnchorFailure(true);
    registerMockReportAnchor(USER, input());
    vi.advanceTimersByTime(1_200);
    const firstTx = getMockReportAnchor(USER, keyOf(input()))?.txHash ?? null;
    // 첫 시도는 실패라 txHash가 null이었어야 한다 — 실패 상태는 txHash를 노출하지 않는다.
    expect(firstTx).toBeNull();

    setMockReportAnchorFailure(false);
    registerMockReportAnchor(USER, input());
    vi.advanceTimersByTime(1_200);
    const secondTx = getMockReportAnchor(USER, keyOf(input()))?.txHash ?? null;
    expect(secondTx).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("실패 스위치", () => {
  it("mockReportAnchorFailing이 스위치 상태를 그대로 비춘다", () => {
    expect(mockReportAnchorFailing()).toBe(false);
    setMockReportAnchorFailure(true);
    expect(mockReportAnchorFailing()).toBe(true);
  });

  it("등록 시점에 스위치가 켜져 있으면 그 시도는 failed로 못 박힌다", () => {
    setMockReportAnchorFailure(true);
    registerMockReportAnchor(USER, input());
    vi.advanceTimersByTime(1_200);
    expect(getMockReportAnchor(USER, keyOf(input()))?.anchorStatus).toBe("failed");
  });
});

describe("복합 키 — 해시가 같아도 메타가 다르면 별개 레코드", () => {
  it("같은 해시·다른 taxYear는 서로 다른 레코드다", () => {
    const a = input({ taxYear: 2026 });
    const b = input({ taxYear: 2027 });
    registerMockReportAnchor(USER, a);
    registerMockReportAnchor(USER, b);
    expect(mockReportAnchorCount()).toBe(2);

    vi.advanceTimersByTime(1_200);
    const recordA = getMockReportAnchor(USER, keyOf(a));
    const recordB = getMockReportAnchor(USER, keyOf(b));
    expect(recordA?.taxYear).toBe(2026);
    expect(recordB?.taxYear).toBe(2027);
    expect(recordA?.txHash).not.toBe(recordB?.txHash);
  });

  it("같은 해시·다른 kind는 서로 다른 레코드다", () => {
    const csv = input({ kind: "csv" });
    const xlsx = input({ kind: "xlsx" });
    registerMockReportAnchor(USER, csv);
    registerMockReportAnchor(USER, xlsx);
    expect(mockReportAnchorCount()).toBe(2);

    vi.advanceTimersByTime(1_200);
    const recordCsv = getMockReportAnchor(USER, keyOf(csv));
    const recordXlsx = getMockReportAnchor(USER, keyOf(xlsx));
    expect(recordCsv?.kind).toBe("csv");
    expect(recordXlsx?.kind).toBe("xlsx");
    expect(recordCsv?.txHash).not.toBe(recordXlsx?.txHash);
  });

  it("남의 기록은 보이지 않는다(userKey 범위)", () => {
    registerMockReportAnchor(USER, input());
    expect(getMockReportAnchor("someone-else", keyOf(input()))).toBeNull();
  });
});

describe("resetMockReportAnchors", () => {
  it("저장소 전체를 비운다", () => {
    registerMockReportAnchor(USER, input());
    registerMockReportAnchor(USER, input({ taxYear: 2026 }));
    expect(mockReportAnchorCount()).toBe(2);
    resetMockReportAnchors();
    expect(mockReportAnchorCount()).toBe(0);
    expect(getMockReportAnchor(USER, keyOf(input()))).toBeNull();
  });
});
