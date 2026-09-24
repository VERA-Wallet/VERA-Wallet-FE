import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReportVcIssueCard } from "@/components/report-vc/issue-card";
import type { ReportVcClient } from "@/lib/report-vc/client";
import { FIXTURE_CAPABILITIES, FIXTURE_ROOT, fixtureIssuanceOffer, fixtureIssuanceState, fixtureIssued } from "@/lib/report-vc/fixtures";
import { ReportVcError } from "@/lib/report-vc/types";

const live = <T,>(data: T) => ({ data, provenance: "live" as const });

type Fake = { [K in keyof ReportVcClient]: ReturnType<typeof vi.fn> };

function fakeClient(over: Partial<Fake> = {}): Fake {
  return {
    capabilities: vi.fn().mockResolvedValue(live(FIXTURE_CAPABILITIES)),
    walletState: vi.fn(),
    createLinkAttempt: vi.fn(),
    linkAttemptStatus: vi.fn(),
    cancelLinkAttempt: vi.fn(),
    unlinkWallet: vi.fn(),
    evidenceIssuance: vi.fn().mockResolvedValue(live(fixtureIssuanceState())),
    requestIssuance: vi.fn().mockImplementation(async () => live(fixtureIssuanceOffer(Date.now(), 10_000))),
    issuanceStatus: vi.fn().mockResolvedValue(live({ status: "offer_ready", retryAfterMs: 2000 })),
    cancelIssuance: vi.fn().mockResolvedValue(undefined),
    createVerification: vi.fn(),
    verificationStatus: vi.fn(),
    cancelVerification: vi.fn(),
    checkFile: vi.fn(),
    ...over,
  };
}

const client = (fake: Fake) => fake as unknown as ReportVcClient;
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const surface = (name: string) => document.querySelector(`[data-surface="${name}"]`);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function renderCard(fake: Fake, stale = false) {
  render(<ReportVcIssueCard evidenceId={FIXTURE_ROOT} stale={stale} client={client(fake)} />);
  await flush();
}

async function request(fake: Fake) {
  await renderCard(fake);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "증명서 발급 요청" })); });
  await flush();
}

describe("VC로 받기 카드", () => {
  it("기능이 준비되지 않았으면 그렇게 말하고 발급 상태를 묻지 않는다", async () => {
    const fake = fakeClient({ capabilities: vi.fn().mockRejectedValue(new ReportVcError(404, "feature_unavailable", "nope")) });
    await renderCard(fake);
    expect(surface("report-vc-issue-unavailable")?.textContent).toContain("준비되지 않았습니다");
    expect(fake.evidenceIssuance).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "증명서 발급 요청" })).toBeNull();
  });

  it("지갑 미연결이면 설정으로 안내하고 발급 버튼을 내놓지 않는다", async () => {
    await renderCard(fakeClient({ evidenceIssuance: vi.fn().mockResolvedValue(live(fixtureIssuanceState({ eligibility: "wallet_unlinked" }))) }));
    expect(surface("report-vc-issue-wallet_unlinked")).not.toBeNull();
    expect(screen.getByRole("link", { name: "설정에서 지갑 연결" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("button", { name: "증명서 발급 요청" })).toBeNull();
  });

  it.each([
    ["anchor_pending", "기다리고"],
    ["anchor_failed", "실패"],
    ["anchor_missing", "찾지 못했습니다"],
    ["disabled", "꺼져"],
  ] as const)("근거가 %s이면 상태와 다음 행동을 말한다", async (eligibility, text) => {
    await renderCard(fakeClient({ evidenceIssuance: vi.fn().mockResolvedValue(live(fixtureIssuanceState({ eligibility }))) }));
    expect(surface(`report-vc-issue-${eligibility}`)?.textContent).toContain(text);
    expect(screen.queryByRole("button", { name: "증명서 발급 요청" })).toBeNull();
  });

  it("발급 요청은 식별자와 멱등성 키만 보내고, QR은 완료가 아니며, 서버가 issued를 줄 때 완료가 된다", async () => {
    const fake = fakeClient();
    await request(fake);
    expect(fake.requestIssuance).toHaveBeenCalledTimes(1);
    const [input] = fake.requestIssuance.mock.calls[0] as [{ evidenceId: string; idempotencyKey: string }];
    expect(input.evidenceId).toBe(FIXTURE_ROOT);
    expect(input.idempotencyKey).toMatch(/[0-9a-f-]{20,}/);
    expect(Object.keys(input).sort()).toEqual(["evidenceId", "idempotencyKey"]);

    expect(screen.getByTitle("증명서 발급 QR 코드").closest("svg")).toBeInTheDocument();
    expect(surface("report-vc-issued")).toBeNull();

    await tick(2000);
    expect(fake.issuanceStatus).toHaveBeenCalledTimes(1);
    expect(surface("report-vc-issued")).toBeNull();

    fake.issuanceStatus.mockResolvedValue(live({ status: "issuing", retryAfterMs: 2000 }));
    await tick(2000);
    expect(screen.getByText(/발급 서버가 증명서를 만들고/)).toBeInTheDocument();
    expect(surface("report-vc-issued")).toBeNull();

    fake.issuanceStatus.mockResolvedValue(live(fixtureIssued(fixtureIssuanceOffer())));
    await tick(2000);
    expect(surface("report-vc-issued")?.textContent).toContain("증명서가 발급되었습니다");
    expect(surface("report-vc-issued")?.textContent).toContain("버전 1");
    expect(screen.getByRole("button", { name: "새 버전으로 다시 받기" })).toBeInTheDocument();
    await tick(10_000);
    expect(fake.issuanceStatus).toHaveBeenCalledTimes(3);
  });

  it("발급 요청 중에는 중복 클릭이 새 요청을 만들지 않는다", async () => {
    let release!: (value: unknown) => void;
    const fake = fakeClient({ requestIssuance: vi.fn().mockImplementation(() => new Promise((resolve) => { release = resolve; })) });
    await renderCard(fake);
    const button = screen.getByRole("button", { name: "증명서 발급 요청" });
    await act(async () => { fireEvent.click(button); });
    await flush();
    expect(screen.queryByRole("button", { name: "증명서 발급 요청" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("발급을 요청하고");
    expect(fake.requestIssuance).toHaveBeenCalledTimes(1);
    await act(async () => { release(live(fixtureIssuanceOffer(Date.now(), 10_000))); });
    expect(fake.requestIssuance).toHaveBeenCalledTimes(1);
  });

  it("서버가 expired를 돌려주면 안전하게 다시 시도할 수 있고 새 시도는 새 멱등성 키를 쓴다", async () => {
    const fake = fakeClient({ issuanceStatus: vi.fn().mockResolvedValue(live({ ...fixtureIssuanceOffer(), status: "expired" })) });
    await request(fake);
    await tick(2000);
    expect(surface("report-vc-issue-notice")?.textContent).toContain("만료");
    expect(surface("report-vc-issued")).toBeNull();

    fake.issuanceStatus.mockResolvedValue(live({ status: "offer_ready", retryAfterMs: 2000 }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "증명서 발급 요청" })); });
    await flush();
    expect(fake.requestIssuance).toHaveBeenCalledTimes(2);
    const keys = fake.requestIssuance.mock.calls.map((call) => (call[0] as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("QR이 로컬 시계로 만료되면 폴링을 멈춘다", async () => {
    const fake = fakeClient();
    await request(fake);
    await tick(11_000);
    expect(surface("report-vc-issue-notice")?.textContent).toContain("만료");
    const calls = fake.issuanceStatus.mock.calls.length;
    await tick(10_000);
    expect(fake.issuanceStatus).toHaveBeenCalledTimes(calls);
  });

  it("네트워크 실패로 응답을 못 받은 재전송은 같은 멱등성 키를 쓴다", async () => {
    const fake = fakeClient({
      requestIssuance: vi.fn()
        .mockRejectedValueOnce(new ReportVcError(0, "feature_unavailable", "서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요."))
        .mockImplementation(async () => live(fixtureIssuanceOffer(Date.now(), 10_000))),
    });
    await request(fake);
    // 네트워크 실패는 카드를 "준비 중"으로 접지 않는다. 오류를 보이고 같은 키로 다시 보낼 수 있어야 한다.
    expect(screen.getByRole("alert")).toHaveTextContent("연결하지 못했습니다");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "증명서 발급 요청" })); });
    await flush();
    expect(fake.requestIssuance).toHaveBeenCalledTimes(2);
    const keys = fake.requestIssuance.mock.calls.map((call) => (call[0] as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(screen.getByTitle("증명서 발급 QR 코드")).toBeInTheDocument();
  });

  it("발급 취소는 서버에 알리고 늦은 issued를 무시한다", async () => {
    let finish!: (value: unknown) => void;
    const fake = fakeClient({ issuanceStatus: vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; })) });
    await request(fake);
    await tick(2000);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "발급 취소" })); });
    expect(fake.cancelIssuance).toHaveBeenCalledWith("issuance-preview-1");
    await act(async () => { finish(live(fixtureIssued(fixtureIssuanceOffer()))); await vi.advanceTimersByTimeAsync(5000); });
    expect(surface("report-vc-issued")).toBeNull();
    expect(surface("report-vc-issue-notice")?.textContent).toContain("취소");
  });

  it("세션이 만료되면 폴링을 멈추고 재로그인을 안내한다", async () => {
    const fake = fakeClient({ issuanceStatus: vi.fn().mockRejectedValue(new ReportVcError(401, "unauthorized", "Unauthorized")) });
    await request(fake);
    await tick(2000);
    expect(surface("report-vc-issue-session")).not.toBeNull();
    expect(screen.getByRole("link", { name: "다시 로그인" })).toHaveAttribute("href", "/login");
    await tick(10_000);
    expect(fake.issuanceStatus).toHaveBeenCalledTimes(1);
  });

  it("같은 근거의 발급이 진행 중이면 새로 만들지 않고 상태를 다시 읽는다", async () => {
    const fake = fakeClient({
      requestIssuance: vi.fn().mockRejectedValue(new ReportVcError(409, "issuance_in_progress", "busy", 2000, { issuanceId: "i-9" })),
    });
    await request(fake);
    expect(fake.evidenceIssuance).toHaveBeenCalledTimes(2);
    expect(surface("report-vc-issue-notice")?.textContent).toContain("진행 중인 발급");
  });

  it("이미 발급된 최근 건이 있으면 완료 상태로 열리고 새 버전 발급을 제안한다", async () => {
    const issued = fixtureIssued(fixtureIssuanceOffer());
    await renderCard(fakeClient({ evidenceIssuance: vi.fn().mockResolvedValue(live(fixtureIssuanceState({ latest: issued }))) }));
    expect(surface("report-vc-issued")).not.toBeNull();
    expect(screen.getByRole("button", { name: "새 버전으로 다시 받기" })).toBeInTheDocument();
  });

  it("계산이 바뀐 뒤에는 기록된 근거 기준으로 발급된다고 말한다", async () => {
    await renderCard(fakeClient(), true);
    expect(surface("report-vc-issue-stale")?.textContent).toContain("기록된 근거 기준");
  });

  it("mock 출처의 issued는 실제 발급이 아니라고 함께 말한다", async () => {
    const fake = fakeClient({ issuanceStatus: vi.fn().mockResolvedValue({ data: fixtureIssued(fixtureIssuanceOffer()), provenance: "mock" }) });
    await request(fake);
    await tick(2000);
    expect(surface("report-vc-issued")?.textContent).toContain("실제 발급이 아닙니다");
    expect(screen.getByTestId("mock-provenance")).toBeInTheDocument();
  });

  it("문구는 추정 리포트 증명서로 부르고 공식 문서가 아님을 밝힌다", async () => {
    await renderCard(fakeClient());
    const text = surface("report-vc-issue")?.textContent ?? "";
    expect(text).toContain("추정 세금 리포트 증명서");
    expect(text).toContain("공식 문서가 아닙니다");
  });
});
