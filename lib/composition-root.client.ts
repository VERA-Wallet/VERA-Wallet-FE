import "client-only";

import { HttpAuthClient } from "@/lib/adapters/http/auth-client.http";
import { HttpEventRepository } from "@/lib/adapters/http/event-repository.http";
import { HttpAnchorProofProvider } from "@/lib/adapters/http/anchor-proof-provider.http";
import { HttpReportAnchorProvider } from "@/lib/adapters/http/report-anchor.http";
import { HttpSummaryProvider } from "@/lib/adapters/http/summary-provider.http";
import { HttpTaxEngine } from "@/lib/adapters/http/tax-engine.http";
import { HttpTaxEvidenceProvider } from "@/lib/adapters/http/tax-evidence.http";
import { HttpHoldingsProvider } from "@/lib/adapters/http/holdings-provider.http";
import { HttpWalletsProvider } from "@/lib/adapters/http/wallets-provider.http";

export const eventRepository = new HttpEventRepository();
export const authClient = new HttpAuthClient();
export const anchorProofProvider = new HttpAnchorProofProvider();
export const summaryProvider = new HttpSummaryProvider();
export const taxEngine = new HttpTaxEngine();
export const taxEvidenceProvider = new HttpTaxEvidenceProvider();
export const reportAnchorProvider = new HttpReportAnchorProvider();
export const holdingsProvider = new HttpHoldingsProvider();
export const walletsProvider = new HttpWalletsProvider();
