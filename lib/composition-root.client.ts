import "client-only";

import { HttpAuthClient } from "@/lib/adapters/http/auth-client.http";
import { HttpEventRepository } from "@/lib/adapters/http/event-repository.http";
import { HttpAnchorProofProvider } from "@/lib/adapters/http/anchor-proof-provider.http";
import { HttpSummaryProvider } from "@/lib/adapters/http/summary-provider.http";
import { HttpTaxEngine } from "@/lib/adapters/http/tax-engine.http";

export const eventRepository = new HttpEventRepository();
export const authClient = new HttpAuthClient();
export const anchorProofProvider = new HttpAnchorProofProvider();
export const summaryProvider = new HttpSummaryProvider();
export const taxEngine = new HttpTaxEngine();
