export type SuccessEnvelope<T> = {
  data: T;
  meta: { provenance: "mock"; generatedAt: string };
};

export type ErrorEnvelope = {
  error: { code: string; message: string; details?: unknown };
};

export type ConflictEnvelope<T> = {
  error: { code: "version_conflict"; message: string };
  data: T;
};
