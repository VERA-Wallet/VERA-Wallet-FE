import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVIDENCE_FIXTURE_ESTIMATE } from "@/tests/fixtures/evidence-estimate";
import { buildReportBundle } from "@/lib/export/report-bundle";
import { buildEvidenceDocument, leafHash } from "@/lib/tax/evidence";
import type { EvidenceChainCheck, EvidenceDetail } from "@/lib/ports/tax-evidence";

const ports = vi.hoisted(() => ({ document: vi.fn(), checkChain: vi.fn() }));

vi.mock("@/lib/composition-root.client", () => ({
  taxEvidenceProvider: { document: ports.document, checkChain: ports.checkChain },
}));

import { EvidenceView } from "@/components/report/evidence-view";

const DOCUMENT = buildEvidenceDocument(EVIDENCE_FIXTURE_ESTIMATE);
const ROOT = DOCUMENT.merkleRoot;
const OTHER_ROOT = `0x${"cd".repeat(32)}`;
const TX = `0x${"ab".repeat(32)}`;
// 묶음 등록(파일 잎 포함)의 문서. events는 이 화면의 테스트 범위 밖이라 비워 둔다 — buildReportBundle은
// 빈 events에서도 결정적인 CSV·XLSX 바이트를 낸다(report-hash.ts).
const BUNDLE = buildReportBundle(EVIDENCE_FIXTURE_ESTIMATE, []);

function detailOf(over: Partial<EvidenceDetail> = {}): EvidenceDetail {
  return {
    merkleRoot: ROOT,
    countryCode: "KR",
    taxYear: 2027,
    leafCount: DOCUMENT.leaves.length,
    recordedAt: "2027-05-01T00:00:00.000Z",
    anchorStatus: "anchored",
    txHash: TX,
    blockNumber: "25737864",
    anchoredAt: "2027-05-01T00:00:00.000Z",
    explorerUrl: null,
    version: 1,
    leaves: structuredClone(DOCUMENT.leaves),
    ...over,
  };
}

function checkOf(over: Partial<EvidenceChainCheck> = {}): EvidenceChainCheck {
  return {
    merkleRoot: ROOT, txHash: TX, blockNumber: "25737864",
    readFromChain: true, success: true, anchoredPayloadHash: ROOT, matches: true,
    checkedAt: "2027-05-02T00:00:00.000Z", ...over,
  };
}

beforeEach(() => {
  ports.document.mockReset();
  ports.checkChain.mockReset();
  ports.document.mockResolvedValue(detailOf());
  ports.checkChain.mockResolvedValue(checkOf());
});

describe("계산 근거 화면", () => {
  it("열자마자 체인에 묻는다 — 저장된 값을 되읽지 않고 지금 노드에 묻는다", async () => {
    render(<EvidenceView merkleRoot={ROOT} />);

    expect(await screen.findByText("체인에 이 근거가 있습니다")).toBeInTheDocument();
    expect(ports.checkChain).toHaveBeenCalledWith(ROOT);
    expect(screen.getByText(/블록 25737864/)).toBeInTheDocument();
  });

  it("기록 정보는 조회에 쓸 수 있게 전문으로 보이고, 잎이 아니라 판정 건수로 말한다", async () => {
    render(<EvidenceView merkleRoot={ROOT} />);

    expect(await screen.findByText("기록된 계산 결과 5건")).toBeInTheDocument();
    expect(ports.document).toHaveBeenCalledWith(ROOT);
    expect(screen.getByText(TX)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2027년 귀속 계산 근거" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /리포트/ })).toHaveAttribute("href", "/export");
  });

  it("브라우저가 잎으로 루트를 다시 계산해 기록과 같음을 보인다 — 서버 말을 믿는 대신 센다", async () => {
    render(<EvidenceView merkleRoot={ROOT} />);

    expect(await screen.findByText(/기록된 검증값과 일치합니다/)).toBeInTheDocument();
    // 기록의 루트와 다시 센 루트, 두 자리에 같은 값이 찍힌다.
    expect(screen.getAllByText(ROOT)).toHaveLength(2);
  });

  it("문서가 루트와 맞지 않으면 숨기지 않는다 — 아래 판정은 체인이 덮는 내용이 아니라고 말한다", async () => {
    const tampered = detailOf();
    (tampered.leaves[1] as { amount: string }).amount = "1";
    ports.document.mockResolvedValue(tampered);
    render(<EvidenceView merkleRoot={ROOT} />);

    expect(await screen.findByText(/기록된 검증값과 일치하지 않습니다/)).toBeInTheDocument();
  });

  it("판정 행마다 도장·근거 조문·금액의 뜻을 보인다", async () => {
    render(<EvidenceView merkleRoot={ROOT} />);
    await screen.findByText("기록된 계산 결과 5건");

    expect(screen.getAllByText("과세 · 기타소득 20%")).toHaveLength(2);
    expect(screen.getAllByText("소득세법 제21조제1항제27호")).toHaveLength(2);
    // 행 금액은 세금이 아니다 — 손익·취득가액·수령 FMV로 구분해 말한다.
    expect(screen.getAllByText("손익")).toHaveLength(2);
    expect(screen.getAllByText("취득가액")).toHaveLength(2);
    expect(screen.getByText("수령 FMV")).toBeInTheDocument();
    // 원가 추적용으로 실린 기간 밖 취득은 그 사실을 말한다.
    expect(screen.getByText(/기간 밖/)).toBeInTheDocument();
  });

  it("계산 요약은 헤더 잎에서만 읽는다 — 룰셋 줄과 totals", async () => {
    render(<EvidenceView merkleRoot={ROOT} />);
    await screen.findByText("계산 요약");

    expect(screen.getByText("기본공제")).toBeInTheDocument();
    expect(screen.getByText("소득세")).toBeInTheDocument();
    expect(screen.getByText("과세 대상")).toBeInTheDocument();
    expect(screen.getByText("예상 세금")).toBeInTheDocument();
    expect(screen.getByText(/거주자별 총평균법/)).toBeInTheDocument();
  });

  it("건수 줄은 통화로 꾸미지 않는다 — 잎에 unit이 없어도 '58건'으로 읽힌다", async () => {
    const withCount = detailOf();
    (withCount.leaves[0] as { lines: { key: string; label: string; amount: string }[] }).lines.push({ key: "disposal_count", label: "처분 건수", amount: "58" });
    ports.document.mockResolvedValue(withCount);
    render(<EvidenceView merkleRoot={ROOT} />);
    await screen.findByText("계산 요약");

    expect(screen.getByText("58건")).toBeInTheDocument();
    expect(screen.queryByText("₩58")).toBeNull();
  });

  it("증명 경로는 펼칠 때만 계산하고, 잎 해시와 형제 해시를 보인다", async () => {
    const { container } = render(<EvidenceView merkleRoot={ROOT} />);
    await screen.findByText("기록된 계산 결과 5건");
    expect(container.querySelector('[data-surface="evidence-leaf-proof"]')).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "항목 검증값(해시)와 증명 경로" })[0]);

    const proof = container.querySelector('[data-surface="evidence-leaf-proof"]');
    expect(proof).not.toBeNull();
    // 첫 판정 잎은 leaves[1]이다(0번은 헤더).
    expect(proof!.textContent).toContain(leafHash(DOCUMENT.leaves[1]));
  });

  it("체인의 해시가 다르면 있다고 말하지 않는다", async () => {
    ports.checkChain.mockResolvedValue(checkOf({ matches: false, anchoredPayloadHash: OTHER_ROOT }));
    render(<EvidenceView merkleRoot={ROOT} />);

    expect(await screen.findByText("체인의 값이 이 근거와 다릅니다")).toBeInTheDocument();
    expect(screen.getByText(OTHER_ROOT)).toBeInTheDocument();
  });

  it("체인을 못 읽었을 때 '없다'고 단정하지 않는다", async () => {
    ports.checkChain.mockResolvedValue(checkOf({ readFromChain: false, success: false, matches: false, anchoredPayloadHash: null }));
    render(<EvidenceView merkleRoot={ROOT} />);

    expect(await screen.findByText("체인을 읽지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText(/기록이 없다는 뜻은 아닙니다/)).toBeInTheDocument();
  });

  it("다시 확인을 누르면 체인에 다시 묻는다", async () => {
    render(<EvidenceView merkleRoot={ROOT} />);
    await screen.findByText("체인에 이 근거가 있습니다");

    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));

    await waitFor(() => expect(ports.checkChain).toHaveBeenCalledTimes(2));
  });

  it("내 기록이 아니면 문서를 그리지 않고 돌아갈 길을 준다", async () => {
    ports.document.mockResolvedValue(null);
    ports.checkChain.mockRejectedValue(new Error("Evidence document not found."));
    render(<EvidenceView merkleRoot={ROOT} />);

    expect(await screen.findByText("기록을 찾지 못했습니다")).toBeInTheDocument();
    expect(screen.queryByText(/기록된 계산 결과/)).toBeNull();
    expect(screen.getByRole("link", { name: /리포트/ })).toHaveAttribute("href", "/export");
  });

  it("파일 잎이 없는 옛 문서에는 「파일」 표를 그리지 않는다", async () => {
    render(<EvidenceView merkleRoot={ROOT} />);

    expect(await screen.findByText("기록된 계산 결과 5건")).toBeInTheDocument();
    expect(screen.queryByText(/파일 \d+건/)).toBeNull();
    expect(screen.queryByText("직접 신고용")).toBeNull();
    expect(screen.queryByText("세무사 전달용")).toBeNull();
  });

  it("파일 잎이 있으면 「파일」 표에 CSV·XLSX 두 행을 보이고, 잎 해시와 증명 경로를 펼칠 수 있다", async () => {
    const fileLeaves = BUNDLE.leaves.filter((leaf) => leaf.kind === "file");
    ports.document.mockResolvedValue(
      detailOf({
        merkleRoot: BUNDLE.merkleRoot,
        leafCount: BUNDLE.leaves.length,
        leaves: structuredClone(BUNDLE.leaves),
      }),
    );
    ports.checkChain.mockResolvedValue(checkOf({ merkleRoot: BUNDLE.merkleRoot, anchoredPayloadHash: BUNDLE.merkleRoot }));
    const { container } = render(<EvidenceView merkleRoot={BUNDLE.merkleRoot} />);

    // 판정 건수 옆에 파일 건수가 붙는다 — 잎에서 헤더·판정과 같이 있어도 판정 수는 흔들리지 않는다.
    expect(await screen.findByText("기록된 계산 결과 5건 · 파일 2건")).toBeInTheDocument();
    expect(screen.getByText("직접 신고용")).toBeInTheDocument();
    expect(screen.getByText("세무사 전달용")).toBeInTheDocument();

    // 각 행이 사람이 읽는 크기를 보인다 — 정확한 단위(B·KB·MB)는 파일 크기에 달렸으므로 형태만 확인한다.
    const table = screen.getByRole("table");
    expect(within(table).getAllByText(/^\d+(\.\d+)?(B|KB|MB|GB)$/)).toHaveLength(fileLeaves.length);

    // 판정 잎도 같은 이름의 버튼을 쓰므로 파일 표 안에서만 찾는다.
    const [firstToggle] = within(table).getAllByRole("button", { name: "항목 검증값(해시)와 증명 경로" });
    expect(screen.queryByText("전체 검증값 산출에 필요한 해시(하위 단계부터 표시)")).toBeNull();
    fireEvent.click(firstToggle);

    const proof = container.querySelector('[data-surface="evidence-leaf-proof"]');
    expect(proof).not.toBeNull();
    expect(proof!.textContent).toContain(leafHash(fileLeaves[0]));
  });
});
