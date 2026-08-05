import { z } from "zod";

import type { ConflictEnvelope, ErrorEnvelope, SuccessEnvelope } from "@/lib/http/envelope";

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
const conflictShell = z.object({
  error: z.object({ code: z.literal("version_conflict"), message: z.string() }),
  data: z.unknown(),
});
const successShell = z.object({
  data: z.unknown(),
  meta: z.object({ provenance: z.literal("mock"), generatedAt: z.string() }),
});

const invalidResponse: ErrorEnvelope = {
  error: { code: "invalid_response", message: "The server returned an invalid response." },
};

/**
 * Decode a fetch Response into the discriminated envelope union.
 * `dataSchema` runtime-validates the inner payload at the client boundary;
 * an envelope whose `data` fails validation is surfaced as `invalid_response`.
 */
export async function decodeResponse<T>(
  response: Response,
  dataSchema: z.ZodType<T>,
): Promise<SuccessEnvelope<T> | ErrorEnvelope | ConflictEnvelope<T>> {
  const payload: unknown = await response.json().catch(() => null);
  if (response.status === 409) {
    const shell = conflictShell.safeParse(payload);
    if (shell.success) {
      const data = dataSchema.safeParse(shell.data.data);
      if (data.success) return { error: shell.data.error, data: data.data };
      return invalidResponse;
    }
  }
  if (response.ok) {
    const shell = successShell.safeParse(payload);
    if (shell.success) {
      const data = dataSchema.safeParse(shell.data.data);
      if (data.success) return { data: data.data, meta: shell.data.meta };
      return invalidResponse;
    }
    return invalidResponse;
  }
  const error = errorSchema.safeParse(payload);
  return error.success ? error.data : invalidResponse;
}
