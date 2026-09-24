import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256 } from "viem";

import { ReportVerifyView } from "@/components/report-vc/report-verify-view";
import { buildReportFile } from "@/lib/export/report-hash";
import { buildReportBundle } from "@/lib/export/report-bundle";
import type { ReportVcClient } from "@/lib/report-vc/client";
import { FIXTURE_CAPABILITIES, fixtureVerificationAttempt, fixtureVerificationResult } from "@/lib/report-vc/fixtures";
import { ReportVcError, type VerificationResult } from "@/lib/report-vc/types";
import { merkleProof, type EvidenceFileLeaf } from "@/lib/tax/evidence";
import { EVIDENCE_FIXTURE_ESTIMATE } from "@/tests/fixtures/evidence-estimate";

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
    evidenceIssuance: vi.fn(),
    requestIssuance: vi.fn(),
    issuanceStatus: vi.fn(),
    cancelIssuance: vi.fn(),
    createVerification: vi.fn().mockImplementation(async ({ disclosure }: { disclosure: "basic" | "with_amounts" }) => live(fixtureVerificationAttempt(disclosure, Date.now(), 10_000))),
    verificationStatus: vi.fn().mockResolvedValue(live({ status: "pending", retryAfterMs: 2000 })),
    cancelVerification: vi.fn().mockResolvedValue(undefined),
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

async function renderView(fake: Fake) {
  render(<ReportVerifyView client={client(fake)} />);
  await flush();
}

async function startVerification(fake: Fake, disclosure: "basic" | "with_amounts" = "basic") {
  await renderView(fake);
  if (disclosure === "with_amounts") fireEvent.click(screen.getByRole("radio", { name: /^금액 포함 검증/ }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "검증 QR 만들기" })); });
  await flush();
}

async function completeVerification(fake: Fake, result: VerificationResult, provenance: "live" | "mock" = "live") {
  await startVerification(fake, result.disclosure);
  fake.verificationStatus.mockResolvedValue({ data: result, provenance });
  await tick(2000);
}

/** 근거 묶음의 CSV 파일과 그 잎·증명. 파일 대조 성공 케이스가 실제 머클 증명으로 통과하게 한다. */
function csvEvidence() {
  const bundle = buildReportBundle(EVIDENCE_FIXTURE_ESTIMATE, []);
  const file = buildReportFile("csv", [], EVIDENCE_FIXTURE_ESTIMATE);
  const index = bundle.leaves.findIndex((leaf) => leaf.kind === "file" && leaf.file === "csv");
  const leaf = bundle.leaves[index] as EvidenceFileLeaf;
  return { root: bundle.merkleRoot, bytes: file.bytes, leaf, proof: merkleProof(bundle.leaves, index) };
}

function upload(name: string, bytes: Uint8Array, type: string) {
  const file = new File([bytes as BlobPart], name, { type });
  if (typeof file.arrayBuffer !== "function") {
    Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  }
  const input = screen.getByLabelText("대조할 파일 선택") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

describe("제3자 검증 화면", () => {
  it("기능이 없으면 준비 중으로 보이고 시도를 만들지 않는다", async () => {
    const fake = fakeClient({ capabilities: vi.fn().mockRejectedValue(new ReportVcError(404, "feature_unavailable", "nope")) });
    await renderView(fake);
    expect(surface("report-vc-verify-unavailable")?.textContent).toContain("준비되지 않았습니다");
    expect(screen.queryByRole("button", { name: "검증 QR 만들기" })).toBeNull();
  });

  it("기본 검증이 기본 선택이고 금액 포함은 서버가 지원할 때만 고를 수 있다", async () => {
    await renderView(fakeClient({ capabilities: vi.fn().mockResolvedValue(live({ ...FIXTURE_CAPABILITIES, disclosures: ["basic"] })) }));
    expect(screen.getByRole("radio", { name: /^기본 검증/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^금액 포함 검증/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /^금액 포함 검증/ })).not.toBeChecked();
  });

  it("QR을 만들고 폴링하다가 결과가 오면 항목별로 보인다", async () => {
    const fake = fakeClient();
    await startVerification(fake);
    expect(fake.createVerification).toHaveBeenCalledWith({ disclosure: "basic" });
    expect(screen.getByTitle("리포트 증명서 검증 QR 코드").closest("svg")).toBeInTheDocument();
    await tick(2000);
    expect(fake.verificationStatus).toHaveBeenCalledTimes(1);
    expect(surface("report-vc-verify-result")).toBeNull();

    fake.verificationStatus.mockResolvedValue(live(fixtureVerificationResult("basic")));
    await tick(2000);
    const result = surface("report-vc-verify-result") as HTMLElement;
    expect(result.textContent).toContain("제출된 증명서를 검증했습니다");
    const rows = within(result).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-outcome"))).toEqual(["pass", "pass", "pass", "pass"]);
    expect(result.textContent).toContain("폐기되지 않음");
    expect(result.textContent).toContain("최신 버전");
    // 서버 근거가 없으면 모바일 신분증 계정 연결을 말하지 않는다.
    expect(result.textContent).not.toContain("모바일 신분증");
    // 기본 검증에는 금액이 없다.
    expect(surface("report-vc-verify-amounts")).toBeNull();
    expect(result.textContent).toContain("금액은 이 검증에서 공개되지 않았습니다");
    await tick(10_000);
    expect(fake.verificationStatus).toHaveBeenCalledTimes(2);
  });

  it("미확인·미지원·실패는 어느 것도 성공으로 표시하지 않고, 폐기와 최신 버전을 구분한다", async () => {
    const result = fixtureVerificationResult("basic", {
      status: "rejected",
      checks: { issuerAndPresentation: "failed", revocation: "unknown", version: "superseded", chainAnchor: "unsupported" },
    });
    await completeVerification(fakeClient(), result);
    const view = surface("report-vc-verify-result") as HTMLElement;
    expect(view.textContent).toContain("검증에 실패했습니다");
    const rows = within(view).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-outcome"))).toEqual(["fail", "unknown", "fail", "unsupported"]);
    expect(view.textContent).toContain("폐기 여부를 확인하지 못함");
    expect(view.textContent).toContain("이후 버전이 있음");
    expect(surface("report-vc-file-check")).toBeNull();
  });

  it("폐기되지 않았지만 최신이 아닌 경우를 따로 말한다", async () => {
    const result = fixtureVerificationResult("basic", { checks: { issuerAndPresentation: "passed", revocation: "active", version: "superseded", chainAnchor: "passed" } });
    await completeVerification(fakeClient(), result);
    const view = surface("report-vc-verify-result") as HTMLElement;
    const rows = within(view).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-outcome"))).toEqual(["pass", "pass", "fail", "pass"]);
  });

  it("서버가 계정 연결을 확인했을 때만 모바일 신분증 행을 보이고, 개인정보는 보이지 않는다", async () => {
    await completeVerification(fakeClient(), fixtureVerificationResult("basic", { accountLink: "verified" }));
    const view = surface("report-vc-verify-result") as HTMLElement;
    expect(view.textContent).toContain("모바일 신분증으로 확인된 계정");
    expect(view.textContent).not.toMatch(/이름|CI|주민/);
  });

  it("금액 포함 검증은 합계를 KRW로 보인다", async () => {
    const fake = fakeClient();
    await completeVerification(fake, fixtureVerificationResult("with_amounts"));
    expect(fake.createVerification).toHaveBeenCalledWith({ disclosure: "with_amounts" });
    const amounts = surface("report-vc-verify-amounts") as HTMLElement;
    expect(amounts.textContent).toContain("₩183,333");
    expect(amounts.textContent).toContain("₩1,200,000");
  });

  it("mock 출처 결과는 실제 검증이 아니라고 함께 말한다", async () => {
    await completeVerification(fakeClient(), fixtureVerificationResult("basic"), "mock");
    expect(surface("report-vc-verify-result")?.textContent).toContain("실제 검증 아님");
    expect(screen.getByTestId("mock-provenance")).toBeInTheDocument();
  });

  it("취소하면 서버에 알리고 늦은 결과를 무시한다", async () => {
    let finish!: (value: unknown) => void;
    const fake = fakeClient({ verificationStatus: vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; })) });
    await startVerification(fake);
    await tick(2000);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "검증 취소" })); });
    expect(fake.cancelVerification).toHaveBeenCalledWith("verification-preview-1");
    await act(async () => { finish(live(fixtureVerificationResult("basic"))); await vi.advanceTimersByTimeAsync(5000); });
    expect(surface("report-vc-verify-result")).toBeNull();
    expect(surface("report-vc-verify-notice")?.textContent).toContain("취소");
  });

  it("QR이 만료되면 폴링을 멈추고 새 검증을 안내한다", async () => {
    const fake = fakeClient();
    await startVerification(fake);
    await tick(11_000);
    expect(surface("report-vc-verify-notice")?.textContent).toContain("만료");
    const calls = fake.verificationStatus.mock.calls.length;
    await tick(10_000);
    expect(fake.verificationStatus).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole("button", { name: "검증 QR 만들기" })).toBeInTheDocument();
  });

  it("서버 오류(410)는 종결이고 폴링이 멈춘다", async () => {
    const fake = fakeClient({ verificationStatus: vi.fn().mockRejectedValue(new ReportVcError(410, "attempt_expired", "gone")) });
    await startVerification(fake);
    await tick(2000);
    expect(surface("report-vc-verify-notice")?.textContent).toContain("만료");
    await tick(10_000);
    expect(fake.verificationStatus).toHaveBeenCalledTimes(1);
  });

  it("다른 브라우저의 시도(403)는 결과를 보이지 않는다", async () => {
    const fake = fakeClient({ verificationStatus: vi.fn().mockRejectedValue(new ReportVcError(403, "attempt_not_bound", "not yours")) });
    await startVerification(fake);
    await tick(2000);
    expect(screen.getByRole("alert")).toHaveTextContent("이 브라우저에서 시작한 시도가 아닙니다");
    expect(surface("report-vc-verify-result")).toBeNull();
  });

  describe("받은 파일 대조", () => {
    it("CSV는 브라우저에서 해시만 계산해 보내고, 서버 포함 판정과 머클 증명 재검증이 모두 맞을 때만 성공이다", async () => {
      const { root, bytes, leaf, proof } = csvEvidence();
      const fake = fakeClient({ checkFile: vi.fn().mockResolvedValue(live({ format: "csv", hash: leaf.hash, status: "included", leaf, proof, evidenceRoot: root })) });
      await completeVerification(fake, fixtureVerificationResult("basic", { claims: { ...fixtureVerificationResult("basic").claims!, evidenceRoot: root } }));
      expect(surface("report-vc-file-check")?.textContent).toContain("파일은 업로드되지 않으며");

      upload("report.csv", bytes, "text/csv");
      await flush();
      await flush();
      expect(fake.checkFile).toHaveBeenCalledTimes(1);
      const [id, input] = fake.checkFile.mock.calls[0] as [string, { format: string; hash: string; byteLength: number; algorithm: string }];
      expect(id).toBe("verification-preview-1");
      expect(input).toEqual({ format: "csv", algorithm: "keccak256", hash: keccak256(bytes), byteLength: bytes.byteLength });
      expect(surface("report-vc-file-included")?.textContent).toContain("근거에 포함되어 있습니다");
    });

    it("서버가 포함이라고 해도 증명이 없거나 재검증에 실패하면 성공으로 표시하지 않는다", async () => {
      const { root, bytes, leaf, proof } = csvEvidence();
      const fake = fakeClient({ checkFile: vi.fn().mockResolvedValue(live({ format: "csv", hash: leaf.hash, status: "included", evidenceRoot: root })) });
      await completeVerification(fake, fixtureVerificationResult("basic"));
      upload("report.csv", bytes, "text/csv");
      await flush();
      await flush();
      expect(surface("report-vc-file-included")).toBeNull();
      expect(surface("report-vc-file-unverified")?.textContent).toContain("성공으로 표시하지 않습니다");

      // 증명이 다른 루트로 이어지면 실패다.
      fake.checkFile.mockResolvedValue(live({ format: "csv", hash: leaf.hash, status: "included", leaf, proof, evidenceRoot: `0x${"ee".repeat(32)}` }));
      upload("report.csv", bytes, "text/csv");
      await flush();
      await flush();
      expect(surface("report-vc-file-included")).toBeNull();
      expect(surface("report-vc-file-unverified")?.textContent).toContain("맞지 않습니다");
    });

    it("근거에 없는 파일은 실패로 보인다", async () => {
      const { root, bytes } = csvEvidence();
      const fake = fakeClient({ checkFile: vi.fn().mockResolvedValue(live({ format: "csv", hash: keccak256(bytes), status: "not_included", evidenceRoot: root })) });
      await completeVerification(fake, fixtureVerificationResult("basic"));
      upload("other.csv", bytes, "text/csv");
      await flush();
      await flush();
      expect(surface("report-vc-file-not-included")?.textContent).toContain("근거에 없습니다");
    });

    it("PDF는 서버에 묻지 않고 미지원으로 말한다", async () => {
      const fake = fakeClient();
      await completeVerification(fake, fixtureVerificationResult("basic"));
      upload("report.pdf", new TextEncoder().encode("%PDF-1.4"), "application/pdf");
      await flush();
      expect(fake.checkFile).not.toHaveBeenCalled();
      expect(surface("report-vc-file-unsupported")?.textContent).toContain("검증할 수 없습니다");
    });

    it("서버가 지원 형식에서 뺀 형식은 묻지 않는다", async () => {
      const fake = fakeClient({ capabilities: vi.fn().mockResolvedValue(live({ ...FIXTURE_CAPABILITIES, fileFormats: ["csv"] })) });
      await completeVerification(fake, fixtureVerificationResult("basic"));
      upload("report.xlsx", new Uint8Array([80, 75, 3, 4]), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      await flush();
      expect(fake.checkFile).not.toHaveBeenCalled();
      expect(surface("report-vc-file-unsupported")?.textContent).toContain("지원 형식: CSV");
    });
  });
});
