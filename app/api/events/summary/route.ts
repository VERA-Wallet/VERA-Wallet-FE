import { requireCompletedOnboarding } from "@/lib/dal";
import { z } from "zod";

import { summaryProvider } from "@/lib/composition-root.server";
import type { SummaryDTO } from "@/lib/http/dto";
import type { ErrorEnvelope, SuccessEnvelope } from "@/lib/http/envelope";

const periodQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (query) =>
      query.from === undefined || query.to === undefined || Date.parse(query.from) < Date.parse(query.to),
    { message: "from must be earlier than to" },
  );

function success<T>(data: T): SuccessEnvelope<T> {
  return { data, meta: { provenance: "mock", generatedAt: new Date().toISOString() } };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = periodQuerySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  if (!parsed.success) {
    const body: ErrorEnvelope = {
      error: { code: "invalid_request", message: "Period query must be RFC 3339 with from earlier than to." },
    };
    return Response.json(body, { status: 400 });
  }
  if (!await requireCompletedOnboarding(request)) {
    const body: ErrorEnvelope = { error: { code: "unauthorized", message: "Completed onboarding required." } };
    return Response.json(body, { status: 401 });
  }
  const data = await summaryProvider.getSummary(parsed.data);
  return Response.json(success<SummaryDTO>(data));
}
