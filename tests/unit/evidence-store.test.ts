import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  documentMockEvidence,
  latestMockEvidence,
  mockEvidenceCount,
  mockEvidenceFailing,
  recordMockEvidence,
  resetMockEvidence,
  setMockEvidenceFailure,
} from "@/lib/mock/evidence-store";
import { buildEvidenceDocument } from "@/lib/tax/evidence";
import { EVIDENCE_FIXTURE_ESTIMATE } from "@/tests/fixtures/evidence-estimate";

/**
 * rev 1~4의 `report-anchor-store`(계획 §0-F2 이식 원본)와 같은 전제로 시계를 흉내 낸다: 저장소는
 * `Date.now()`를 직접 읽으므로 vitest fake timers가 그대로 통한다.
 *
 * `EvidenceRecord`에는 `attempt`·`failureReason`이 없다(계획 §0-F1) — 아래 단언은 응답에
 * 그 필드가 **없다**는 것까지 확인한다.
 */

const USER = "0xabc";

function leaves() {
  return buildEvidenceDocument(EVIDENCE_FIXTURE_ESTIMATE).leaves;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2027-05-01T00:00:00.000Z"));
});

afterEach(() => {
  resetMockEvidence();
  vi.useRealTimers();
});

describe("recordMockEvidence: pending → anchored 전이", () => {
  it("등록 즉시는 pending이고, 지연(2.5초)이 지나야 anchored로 정착한다", () => {
    const record = recordMockEvidence(USER, leaves());
    expect(record.anchorStatus).toBe("pending");
    expect(record.txHash).toBeNull();
    expect(record.blockNumber).toBeNull();
    expect(record.anchoredAt).toBeNull();
    expect(record).not.toHaveProperty("attempt");
    expect(record).not.toHaveProperty("failureReason");

    vi.advanceTimersByTime(2_499);
    expect(latestMockEvidence(USER, record.countryCode, record.taxYear)?.anchorStatus).toBe("pending");

    vi.advanceTimersByTime(1);
    const anchored = latestMockEvidence(USER, record.countryCode, record.taxYear);
    expect(anchored?.anchorStatus).toBe("anchored");
    expect(anchored?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(anchored?.blockNumber).not.toBeNull();
    expect(anchored?.anchoredAt).toBe("2027-05-01T00:00:02.500Z");
  });
});

describe("recordMockEvidence: 멱등", () => {
  it("pending 상태에 재등록하면 같은 시도를 그대로 돌려준다(트랜잭션 중복 없음)", () => {
    const doc = leaves();
    const first = recordMockEvidence(USER, doc);
    const second = recordMockEvidence(USER, doc);
    expect(second.anchorStatus).toBe("pending");
    expect(second.recordedAt).toBe(first.recordedAt);
  });

  it("anchored 상태에 재등록해도 같은 기록을 그대로 돌려준다(새 트랜잭션 없음)", () => {
    const doc = leaves();
    recordMockEvidence(USER, doc);
    vi.advanceTimersByTime(2_500);
    const anchored = recordMockEvidence(USER, doc);
    expect(anchored.anchorStatus).toBe("anchored");
    const txHash = anchored.txHash;

    const again = recordMockEvidence(USER, doc);
    expect(again.txHash).toBe(txHash);
  });
});

describe("recordMockEvidence: failed → pending 재제출", () => {
  it("실패로 정착한 뒤 재등록하면 곧바로 pending으로 열린다(잠시 failed가 남지 않는다)", () => {
    setMockEvidenceFailure(true);
    const doc = leaves();
    const registered = recordMockEvidence(USER, doc);
    vi.advanceTimersByTime(2_500);
    const failed = latestMockEvidence(USER, registered.countryCode, registered.taxYear);
    expect(failed?.anchorStatus).toBe("failed");
    expect(failed?.txHash).toBeNull();

    // 실패 스위치를 끄고 재제출한다 — 재제출한 그 순간부터 pending이다.
    setMockEvidenceFailure(false);
    const retried = recordMockEvidence(USER, doc);
    expect(retried.anchorStatus).toBe("pending");

    vi.advanceTimersByTime(2_500);
    const anchored = latestMockEvidence(USER, registered.countryCode, registered.taxYear);
    expect(anchored?.anchorStatus).toBe("anchored");
  });

  it("재시도한 트랜잭션 해시는 첫 시도와 다르다(attempt가 내부적으로 preimage에 들어간다)", () => {
    setMockEvidenceFailure(true);
    const doc = leaves();
    const registered = recordMockEvidence(USER, doc);
    vi.advanceTimersByTime(2_500);
    // 실패 상태는 txHash를 노출하지 않는다.
    expect(latestMockEvidence(USER, registered.countryCode, registered.taxYear)?.txHash).toBeNull();

    setMockEvidenceFailure(false);
    recordMockEvidence(USER, doc);
    vi.advanceTimersByTime(2_500);
    const secondTx = latestMockEvidence(USER, registered.countryCode, registered.taxYear)?.txHash ?? null;
    expect(secondTx).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("실패 스위치", () => {
  it("mockEvidenceFailing이 스위치 상태를 그대로 비춘다", () => {
    expect(mockEvidenceFailing()).toBe(false);
    setMockEvidenceFailure(true);
    expect(mockEvidenceFailing()).toBe(true);
  });

  it("등록 시점에 스위치가 켜져 있으면 그 시도는 정착 뒤 failed로 못 박힌다", () => {
    setMockEvidenceFailure(true);
    const registered = recordMockEvidence(USER, leaves());
    expect(registered.anchorStatus).toBe("pending");

    vi.advanceTimersByTime(2_500);
    expect(latestMockEvidence(USER, registered.countryCode, registered.taxYear)?.anchorStatus).toBe("failed");
  });
});

describe("resetMockEvidence", () => {
  it("저장소 전체를 비운다", () => {
    const doc = leaves();
    recordMockEvidence(USER, doc);
    expect(mockEvidenceCount()).toBe(1);
    resetMockEvidence();
    expect(mockEvidenceCount()).toBe(0);
  });

  it("실패 스위치도 함께 내린다 — 기록만 비우면 초기화 뒤 첫 등록이 또 실패한다", () => {
    setMockEvidenceFailure(true);
    resetMockEvidence();
    expect(mockEvidenceFailing()).toBe(false);

    const registered = recordMockEvidence(USER, leaves());
    vi.advanceTimersByTime(2_500);
    expect(latestMockEvidence(USER, registered.countryCode, registered.taxYear)?.anchorStatus).toBe("anchored");
  });
});

describe("documentMockEvidence", () => {
  it("루트가 덮는 정본 문서를 잎째 돌려준다", () => {
    const doc = leaves();
    const record = recordMockEvidence(USER, doc);
    const detail = documentMockEvidence(USER, record.merkleRoot);
    expect(detail?.leaves).toHaveLength(doc.length);
    expect(detail?.merkleRoot).toBe(record.merkleRoot);
  });

  it("남의 기록은 보이지 않는다(userKey 범위)", () => {
    const record = recordMockEvidence(USER, leaves());
    expect(documentMockEvidence("someone-else", record.merkleRoot)).toBeNull();
  });
});
