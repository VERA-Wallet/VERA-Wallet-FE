import type { SummaryDTO } from "@/lib/http/dto";

export interface SummaryProvider {
  getSummary(input?: { from?: string; to?: string }): Promise<SummaryDTO>;
}
