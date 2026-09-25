import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ReportInputsProvider, useReportContext } from "@/components/report/report-context";
import { useEventList, useEventSummary } from "@/lib/queries/events";
import { listRuleSetSummaries } from "@/lib/tax/rulesets";
import { computeTaxEstimate } from "@/lib/tax/engine";
const ports = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), proof: vi.fn(), estimate: vi.fn() }));
vi.mock("@/lib/composition-root.client", () => ({
  eventRepository: { list: ports.list }, summaryProvider: { getSummary: ports.summary },
  anchorProofProvider: { getProof: ports.proof },
  taxEngine: { listRuleSets: async () => listRuleSetSummaries(), estimate: ports.estimate },
}));
vi.mock("@/lib/plan/use-plan", async (original) => ({
  ...await original<typeof import("@/lib/plan/use-plan")>(), usePlan: () => ({ plan: null }),
}));
const event = { id: "cached-event", block_timestamp: "2025-05-01T00:00:00Z", classification: "RECEIVE" };
function Transactions() {
  const list = useEventList(); const summary = useEventSummary();
  return <div>{list.isSuccess && summary.isSuccess ? "transactions ready" : "waiting"}</div>;
}
function Report() {
  const report = useReportContext();
  return <div>{report.ready ? `report ready ${report.events.length}` : "report waiting"}<span>{report.taxYear}</span></div>;
}
beforeEach(() => {
  vi.clearAllMocks();
  ports.list.mockResolvedValue({ items: [{ event, version: 1 }], nextCursor: null });
  ports.summary.mockResolvedValue({ period: { from: event.block_timestamp, to: event.block_timestamp }, computableEventCount: 1 });
  ports.proof.mockReturnValue(new Promise(() => {}));
  ports.estimate.mockImplementation(async (input) => computeTaxEstimate({ ...input, events: [] }));
});
it("reuses transaction cache on report navigation and does not wait for anchor proof", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } });
  const view = render(<QueryClientProvider client={client}><Transactions /></QueryClientProvider>);
  await screen.findByText("transactions ready");
  view.rerender(<QueryClientProvider client={client}><ReportInputsProvider countryCode="KR" currentYear={2026}><Report /></ReportInputsProvider></QueryClientProvider>);
  await screen.findByText("report ready 1");
  expect(screen.getByText("2025")).toBeInTheDocument();
  await waitFor(() => expect(ports.proof).toHaveBeenCalledOnce());
  expect(ports.list).toHaveBeenCalledOnce();
  expect(ports.summary).toHaveBeenCalledOnce();
  await waitFor(() => expect(ports.estimate).toHaveBeenCalled());
  expect(ports.estimate.mock.calls.every(([input]) => input.taxYear === 2025)).toBe(true);
});
it("does not compute an assumed current-year result before the ledger arrives", async () => {
  ports.list.mockReturnValue(new Promise(() => {}));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ReportInputsProvider countryCode="KR" currentYear={2026}><Report /></ReportInputsProvider></QueryClientProvider>);
  await waitFor(() => expect(ports.list).toHaveBeenCalled());
  expect(screen.getByText("report waiting")).toBeInTheDocument();
  expect(ports.estimate).not.toHaveBeenCalled();
});
