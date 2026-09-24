import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/** 목록과 상세가 함께 쓰는 한 건. version은 재분류·금액 저장의 낙관적 잠금 기준이다. */
export type EventRecord = { event: NormalizedEvent; version: number };
/** 목록 순서로 계산한 중복 마커. 객체 동일성 대신 이 값을 화면 전체가 공유한다. */
export type AnnotatedRecord = { record: EventRecord; occurrence: number; isDuplicate: boolean };
/** 거래 목록의 탭. */
export type TransactionTab = "all" | "review" | "taxable";
