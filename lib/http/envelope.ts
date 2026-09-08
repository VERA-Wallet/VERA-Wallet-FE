/** 응답 데이터의 출처. BE는 MOCK_MODE에 따라 두 값을 모두 보낸다(`shared/api.ts#success`). FE-소유 라우트도 입력 데이터의 출처를 따른다. */
export type Provenance = "mock" | "live";

export type SuccessEnvelope<T> = {
  data: T;
  meta: { provenance: Provenance; generatedAt: string };
};

export type ErrorEnvelope = {
  error: { code: string; message: string; details?: unknown };
};

export type ConflictEnvelope<T> = {
  error: { code: "version_conflict"; message: string };
  data: T;
};
