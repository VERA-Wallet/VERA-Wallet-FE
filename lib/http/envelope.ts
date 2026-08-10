export type SuccessEnvelope<T> = {
  data: T;
  // BE는 MOCK_MODE에 따라 두 값을 모두 보낸다(`shared/api.ts#success`). 지금 운영 모드가 mock일 뿐 계약은 union이다.
  meta: { provenance: "mock" | "live"; generatedAt: string };
};

export type ErrorEnvelope = {
  error: { code: string; message: string; details?: unknown };
};

export type ConflictEnvelope<T> = {
  error: { code: "version_conflict"; message: string };
  data: T;
};
