"use client";

import { ChevronDown, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Card } from "@/components/ui/card";
import { AMOUNT_KIND_LABEL, GROUP_SHORT_LABEL, JudgmentBadge } from "@/components/ui/judgment-badge";
import { taxEvidenceProvider } from "@/lib/composition-root.client";
import { formatDate, formatDateTime, formatFiat, shortHash } from "@/lib/format";
import type { EvidenceChainCheck, EvidenceDetail } from "@/lib/ports/tax-evidence";
import { canonicalJson, leafHash, merkleProof, merkleRoot } from "@/lib/tax/evidence";
import type { EvidenceFileLeaf, EvidenceHeaderLeaf, EvidenceJudgmentLeaf, EvidenceLeaf } from "@/lib/tax/evidence";
import type { JudgmentGroup, JudgmentRow } from "@/lib/tax/types";

/** 화면의 두 행(직접 신고용·세무사 전달용)과 같은 이름으로 파일 잎을 말한다. */
const FILE_KIND_LABEL: Record<EvidenceFileLeaf["file"], string> = { csv: "직접 신고용", xlsx: "세무사 전달용" };

/** 파일 잎의 `byteLength`(정수 바이트)를 사람이 읽는 단위로. 해시·머클루트처럼 표기 규칙이 갈릴 값이 아니라 화면 전용이다. */
function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)}${units[unitIndex]}`;
}

/** 세금 화면(tax-simulator)이 totals에 붙이는 이름과 같게 둔다 — 같은 값을 두 화면이 다르게 부르지 않는다. */
const TOTAL_LABELS: readonly { key: string; label: string }[] = [
  { key: "estimatedCharge", label: "예상 부담 추정" },
  { key: "taxableGains", label: "과세 대상" },
  { key: "exemptGains", label: "과세표준 제외" },
  { key: "incomeTotal", label: "수령 소득" },
];

/** 교환의 어느 쪽인지. `single`은 이름이 필요 없다(한 이벤트 = 한 행). */
const LEG_LABEL: Record<string, string> = { dispose: "교환 · 내보낸 자산", receive: "교환 · 받은 자산" };

/**
 * 건수 줄 판별. 룰셋의 `unit: "count"`는 헤더 잎에 실리지 않는다 — 잎에 칸을 더하면 정본 규칙이 바뀌어
 * 이미 올라간 앵커를 재현할 수 없다. 대신 룰셋의 count 줄이 공유하는 이름 규칙(`*_count` 키, '건수' 라벨)으로 가른다.
 * 통화로 꾸미면 "처분 건수 ₩58"이 된다 — 세금 화면(tax-simulator)은 unit을 보고 `N건`으로 찍는다.
 */
function isCountLine(line: { key: string; label: string }): boolean {
  return line.key.endsWith("_count") || /건수$/.test(line.label);
}

function isJudgmentGroup(group: string): group is JudgmentGroup {
  return group !== "excluded" && group in GROUP_SHORT_LABEL;
}

function isAmountKind(kind: string): kind is JudgmentRow["amountKind"] {
  return kind in AMOUNT_KIND_LABEL;
}

type Loaded =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: EvidenceDetail };

/**
 * 체인에 봉인한 계산 근거 하나를 **끝까지** 보이는 화면.
 *
 * OmniOne 스테이지에는 블록 탐색기가 없다. 그래서 "체인에서 직접 확인"은 밖으로 나가는 링크가 아니라 이 화면이고,
 * 이 화면은 탐색기가 보여 줄 수 없는 것까지 보인다 — 해시 하나가 아니라 그 해시가 **무엇을 덮는지**.
 *
 * 세 층을 한 자리에 둔다. 위에서 아래로 읽으면 근거의 사슬이 된다:
 *   1. 체인 — 지금 노드에 물어 거래가 실어 나른 해시를 읽고 기록된 루트와 대조한다(서버가 대신 읽는다).
 *   2. 루트 — 서버가 돌려준 잎으로 **브라우저가 직접** 루트를 다시 계산해 기록과 대조한다. 서버 말을 믿는 대신 센다.
 *   3. 잎 — 봉인한 판정 전체. 행마다 잎 해시와 루트까지의 경로를 펼쳐 볼 수 있다(건별 증명).
 */
export function EvidenceView({ merkleRoot: root }: { merkleRoot: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  // 체인 대조는 열자마자 한 번, 그 뒤엔 사용자가 누를 때마다. `run`이 오르면 효과가 다시 돈다.
  const [check, setCheck] = useState<EvidenceChainCheck | null>(null);
  const [checkBusy, setCheckBusy] = useState(true);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let active = true;
    void taxEvidenceProvider
      .document(root)
      .then((detail) => {
        if (active) setLoaded(detail ? { status: "ready", detail } : { status: "missing" });
      })
      .catch((cause: unknown) => {
        if (active) setLoaded({ status: "error", message: cause instanceof Error ? cause.message : "기록을 불러오지 못했습니다." });
      });
    return () => { active = false; };
  }, [root]);

  useEffect(() => {
    let active = true;
    void taxEvidenceProvider
      .checkChain(root)
      .then((result) => {
        if (!active) return;
        setCheck(result);
        setCheckError(null);
      })
      .catch((cause: unknown) => {
        if (active) setCheckError(cause instanceof Error ? cause.message : "체인을 확인하지 못했습니다.");
      })
      .finally(() => { if (active) setCheckBusy(false); });
    return () => { active = false; };
  }, [root, run]);

  const recheck = () => {
    setCheckBusy(true);
    setRun((count) => count + 1);
  };

  const detail = loaded.status === "ready" ? loaded.detail : null;
  // 서버가 준 잎으로 루트를 다시 센다. 잎마다 keccak이므로 문서가 바뀔 때만.
  const recomputedRoot = useMemo(() => (detail ? merkleRoot(detail.leaves) : null), [detail]);
  const intact = detail !== null && recomputedRoot !== null && recomputedRoot.toLowerCase() === detail.merkleRoot.toLowerCase();

  const header = detail?.leaves[0]?.kind === "header" ? (detail.leaves[0] as EvidenceHeaderLeaf) : null;
  const judgmentCount = detail ? detail.leaves.filter((leaf) => leaf.kind === "judgment").length : 0;
  // 파일 잎(csv·xlsx). 묶음 등록 뒤에 생긴 기록에만 있다 — 옛 기록(파일별 등록 이전)에는 없다.
  const fileLeaves = detail ? (detail.leaves.filter((leaf) => leaf.kind === "file") as EvidenceFileLeaf[]) : [];
  // 통화는 헤더 잎이 말한다. 헤더가 없는 문서라면 금액을 꾸미지 않고 그대로 보인다 — 통화를 지어내지 않는다.
  const money = (value: string) => (header ? formatFiat(value, header.currency) : value);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-5 py-8">
      <Link href="/export" className="text-sm font-semibold text-zinc-500">← 리포트</Link>
      <p className="mt-4 text-sm font-semibold text-primary-500">내보내기 · 계산 근거</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-zinc-900">
        {detail ? `${detail.taxYear}년 귀속 계산 근거` : "계산 근거"}
      </h1>
      <p className="mt-3 text-base leading-6 text-zinc-600">
        OmniOne 체인에 봉인한 기록입니다. 체인이 실어 나른 해시, 그 해시(머클루트)를 이 문서로 다시 계산한 값, 그리고
        해시가 덮는 판정 전체를 차례로 보입니다.
      </p>

      {loaded.status === "missing" ? (
        <Card className="mt-5">
          <p className="font-semibold text-zinc-900">기록을 찾지 못했습니다</p>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            이 계정이 기록한 근거가 아니거나 아직 기록되지 않은 루트입니다. 리포트에서 다시 열어 주세요.
          </p>
        </Card>
      ) : (
        <>
          {/* 1. 체인 — 지금 노드에 물은 결과. 저장된 값을 되읽지 않는다. */}
          <section
            data-surface="evidence-chain-result"
            className={`mt-5 rounded-card border p-5 text-sm leading-6 ${
              checkBusy && !check
                ? "border-zinc-200 bg-white text-zinc-600"
                : check?.matches
                  ? "border-primary-200 bg-primary-50/50 text-zinc-700"
                  : check?.readFromChain
                    ? "border-red-200 bg-red-50 text-red-900"
                    : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden className="size-5 shrink-0" strokeWidth={2.5} />
              <p className="font-semibold">체인 대조</p>
            </div>
            {checkBusy && !check ? (
              <p className="mt-2">체인에 묻는 중입니다…</p>
            ) : check === null ? (
              <>
                <p className="mt-2 font-semibold">체인을 확인하지 못했습니다</p>
                {checkError && <p className="mt-1 wrap-anywhere">{checkError}</p>}
              </>
            ) : check.matches ? (
              <>
                <p className="mt-2 font-semibold text-primary-700">체인에 이 근거가 있습니다</p>
                <p className="mt-1">블록 {check.blockNumber}의 거래가 실어 나른 해시가 아래 머클루트와 같습니다.</p>
              </>
            ) : check.readFromChain ? (
              <>
                <p className="mt-2 font-semibold">체인의 값이 이 근거와 다릅니다</p>
                <p className="mt-1 break-all">
                  체인의 해시: <span className="font-mono text-xs">{check.anchoredPayloadHash ?? "읽지 못함"}</span>
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 font-semibold">체인을 읽지 못했습니다</p>
                {/* 못 읽은 것과 없는 것은 다르다. 없다고 단정하지 않는다. */}
                <p className="mt-1">기록이 없다는 뜻은 아닙니다. 잠시 뒤 다시 확인해 주세요.</p>
              </>
            )}
            {detail?.anchorStatus === "pending" && (
              <p className="mt-2">체인에 올리는 중입니다. 거래가 실리면 여기서 대조할 수 있습니다.</p>
            )}
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs opacity-70">{check ? `${formatDateTime(check.checkedAt)} 확인` : ""}</p>
              <button
                type="button"
                onClick={recheck}
                disabled={checkBusy}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-current px-2.5 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw aria-hidden className="size-3.5 shrink-0" strokeWidth={2.5} />
                {checkBusy ? "체인 확인 중…" : "다시 확인"}
              </button>
            </div>
          </section>

          {loaded.status === "loading" && <p className="mt-5 text-sm text-zinc-500">기록을 불러오는 중…</p>}
          {loaded.status === "error" && <p className="mt-5 text-sm wrap-anywhere text-red-600">{loaded.message}</p>}

          {detail && (
            <>
              {/* 2. 기록 — 체인 조회에 쓸 수 있는 값은 줄이지 않고 전문으로 둔다. */}
              <Card className="mt-5">
                <p className="font-semibold text-zinc-900">기록</p>
                <dl className="mt-3 space-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-zinc-500">머클루트</dt>
                    <dd className="mt-0.5 break-all font-mono text-xs text-zinc-900">{detail.merkleRoot}</dd>
                  </div>
                  {detail.txHash && (
                    <div>
                      <dt className="text-xs text-zinc-500">거래 해시 (체인 조회용)</dt>
                      <dd className="mt-0.5 break-all font-mono text-xs text-zinc-900">{detail.txHash}</dd>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <dt className="text-xs text-zinc-500">블록</dt>
                      <dd className="mt-0.5 font-medium text-zinc-900">{detail.blockNumber ?? "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">봉인한 판정</dt>
                      {/* 잎에는 헤더 1개가 함께 들어간다 — 사용자에게는 판정 건수로 말한다. */}
                      <dd className="mt-0.5 font-medium text-zinc-900">{judgmentCount}건</dd>
                    </div>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">기록 시각</dt>
                    <dd className="mt-0.5 font-medium text-zinc-900">{formatDateTime(detail.anchoredAt ?? detail.recordedAt)}</dd>
                  </div>
                </dl>
                {detail.explorerUrl && (
                  <a
                    className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 underline"
                    href={detail.explorerUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <Link2 aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
                    탐색기에서 보기
                  </a>
                )}
              </Card>

              {/* 3. 루트 — 브라우저가 직접 다시 센 값. 서버가 준 잎이 정말 그 루트를 내는지 여기서 드러난다. */}
              <Card data-surface="evidence-recomputed-root" className={`mt-5 ${intact ? "" : "border border-red-200"}`}>
                <p className="font-semibold text-zinc-900">이 문서로 다시 계산한 루트</p>
                <p className="mt-2 break-all font-mono text-xs text-zinc-900">{recomputedRoot}</p>
                {intact ? (
                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    기록된 루트와 같습니다. 아래 판정을 같은 규칙으로 묶으면 체인의 해시가 나옵니다. 한 건이라도 바뀌면 값이 달라집니다.
                  </p>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-red-700">
                    기록된 루트와 다릅니다. 문서가 바뀌었거나 손상됐습니다. 아래 판정은 체인의 해시가 덮는 내용이 아닙니다.
                  </p>
                )}
              </Card>

              {/* 4. 헤더 잎 — 이 계산이 무엇에 대한 계산인지. */}
              {header && (
                <Card className="mt-5">
                  <p className="font-semibold text-zinc-900">계산 요약</p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {header.countryLabel} · {header.taxYear}년 귀속 · {header.method}
                  </p>
                  <p className="text-sm text-zinc-500">
                    기간 {formatDate(header.period.from)} – {formatDate(header.period.to)}
                  </p>
                  {header.lines.length > 0 && (
                    <dl className="mt-3 divide-y divide-zinc-100 border-y border-zinc-100 text-sm">
                      {header.lines.map((line) => (
                        <div key={line.key} className="flex items-start justify-between gap-3 py-2">
                          <dt className="min-w-0 text-zinc-600">
                            {line.label}
                            {line.rate && <span className="ml-1 text-xs text-zinc-400">{line.rate}</span>}
                            {line.basis && <span className="block text-xs wrap-anywhere text-zinc-400">{line.basis}</span>}
                          </dt>
                          <dd className="shrink-0 font-semibold text-zinc-900">{isCountLine(line) ? `${line.amount}건` : money(line.amount)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <dl className="mt-3 grid grid-cols-2 gap-2">
                    {TOTAL_LABELS.filter(({ key }) => header.totals[key] !== undefined).map(({ key, label }) => (
                      <div key={key} className="rounded-card border border-zinc-200 p-3">
                        <dt className="text-xs text-zinc-500">{label}</dt>
                        <dd className="mt-1 text-sm font-bold text-zinc-900">{money(header.totals[key])}</dd>
                      </div>
                    ))}
                  </dl>
                  {header.totals.effectiveRatePercent !== undefined && (
                    <p className="mt-2 text-sm text-zinc-500">실효 {header.totals.effectiveRatePercent}%</p>
                  )}
                  {header.lossCarryforward !== "0" && (
                    <p className="mt-2 text-sm text-zinc-600">다음 기간으로 넘기는 손실 {money(header.lossCarryforward)}</p>
                  )}
                  <RawLeaf leaf={header} />
                </Card>
              )}

              {/* 5. 판정 잎 — 봉인한 것 전부. 숨기는 행이 없어야 "이 루트가 덮는 내용"이 된다. */}
              <Card className="mt-5">
                <p className="font-semibold text-zinc-900">
                  봉인한 판정 {judgmentCount}건
                  {fileLeaves.length > 0 && ` · 파일 ${fileLeaves.length}건`}
                </p>
                {judgmentCount === 0 ? (
                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    판정할 거래가 없어 계산 요약(헤더)만 봉인했습니다.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-zinc-100">
                    {detail.leaves.map((leaf, index) =>
                      leaf.kind === "judgment" ? (
                        <JudgmentLeafRow key={index} leaf={leaf} index={index} leaves={detail.leaves} money={money} />
                      ) : null,
                    )}
                  </ul>
                )}
              </Card>

              {/* 6. 파일 잎 — 이번 등록이 함께 묶은 CSV·XLSX의 지문. 옛 기록(파일별 등록 이전)에는 잎이 없어
                  표 자체를 그리지 않는다 — 없는 파일을 있다고 말하지 않는다. */}
              {fileLeaves.length > 0 && (
                <Card data-surface="evidence-files" className="mt-5">
                  <p className="font-semibold text-zinc-900">파일 {fileLeaves.length}건</p>
                  <table className="mt-3 w-full text-left text-sm">
                    <thead>
                      <tr className="text-xs text-zinc-500">
                        <th className="pb-2 pr-2 font-medium">종류</th>
                        <th className="pb-2 pr-2 font-medium">해시</th>
                        <th className="pb-2 font-medium">크기</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {fileLeaves.map((leaf) => (
                        <FileLeafRow key={leaf.file} leaf={leaf} index={detail.leaves.indexOf(leaf)} leaves={detail.leaves} />
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}

function JudgmentLeafRow({
  leaf,
  index,
  leaves,
  money,
}: {
  leaf: EvidenceJudgmentLeaf;
  index: number;
  leaves: EvidenceLeaf[];
  money: (value: string) => string;
}) {
  const [open, setOpen] = useState(false);
  // 경로는 펼칠 때만 센다 — 잎마다 O(n) keccak이라 목록 전체를 미리 계산하면 판정 수의 제곱으로 는다.
  const proof = useMemo(() => (open ? { hash: leafHash(leaf), steps: merkleProof(leaves, index) } : null), [open, leaf, leaves, index]);

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
        <span>
          {formatDate(leaf.at)}
          {!leaf.inPeriod && " · 기간 밖(원가 추적)"}
        </span>
        {LEG_LABEL[leaf.leg] && <span className="shrink-0">{LEG_LABEL[leaf.leg]}</span>}
      </div>
      <div className="mt-1 flex items-start justify-between gap-3">
        <span className="min-w-0 wrap-anywhere font-semibold text-zinc-900">
          {leaf.symbol} <span className="font-normal text-zinc-500">{leaf.quantity}</span>
        </span>
        <span className="shrink-0 text-right font-semibold text-zinc-900">
          {money(leaf.amount)}
          {/* 행 금액은 세금이 아니다 — 무엇인지 함께 말한다. */}
          <span className="block text-xs font-normal text-zinc-500">{isAmountKind(leaf.amountKind) ? AMOUNT_KIND_LABEL[leaf.amountKind] : leaf.amountKind}</span>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {isJudgmentGroup(leaf.group) ? (
          <JudgmentBadge group={leaf.group} label={leaf.label} />
        ) : (
          <span className="inline-flex rounded-full border border-zinc-300 px-2.5 py-1 text-xs font-semibold text-zinc-600">{leaf.label}</span>
        )}
        {leaf.lots > 1 && <span className="text-xs text-zinc-500">{leaf.lots}개 lot</span>}
        {leaf.holdingDays !== undefined && <span className="text-xs text-zinc-500">보유 {leaf.holdingDays}일</span>}
      </div>
      <p className="mt-1 text-xs leading-5 wrap-anywhere text-zinc-500">{leaf.basis}</p>
      {leaf.breakdown && (
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          양도가액 {money(leaf.breakdown.proceeds)} − 취득가액 {money(leaf.breakdown.cost)} − 수수료 {money(leaf.breakdown.fee)}
        </p>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-zinc-500"
      >
        <ChevronDown aria-hidden className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.5} />
        잎 해시와 증명 경로
      </button>
      {proof && (
        <div data-surface="evidence-leaf-proof" className="mt-2 rounded-card border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-xs text-zinc-500">잎 해시</p>
          <p className="mt-0.5 break-all font-mono text-[11px] text-zinc-800">{proof.hash}</p>
          {proof.steps.length > 0 && (
            <>
              <p className="mt-2 text-xs text-zinc-500">루트까지의 형제 해시 (아래부터 차례로 붙여 올린다)</p>
              <ol className="mt-0.5 space-y-1">
                {proof.steps.map((step, position) => (
                  <li key={position} className="break-all font-mono text-[11px] text-zinc-800">
                    <span className="text-zinc-400">{step.side === "left" ? "왼쪽" : "오른쪽"} </span>
                    {step.hash}
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            이 잎과 형제 해시만으로 루트가 나옵니다. 나머지 거래를 보이지 않고도 이 판정 하나가 봉인됐음을 증명할 수 있습니다.
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * 파일 잎 한 행 — 종류·해시·크기, 펼치면 잎 해시와 루트까지의 증명 경로.
 * 판정 행(`JudgmentLeafRow`)과 같은 방식이다 — 파일 해시가 루트 안에 **어떻게** 들어갔는지가 이 표의 존재 이유다.
 */
function FileLeafRow({ leaf, index, leaves }: { leaf: EvidenceFileLeaf; index: number; leaves: EvidenceLeaf[] }) {
  const [open, setOpen] = useState(false);
  // 경로는 펼칠 때만 센다 — 잎마다 O(n) keccak이라 목록 전체를 미리 계산하면 잎 수의 제곱으로 는다.
  const proof = useMemo(() => (open ? { hash: leafHash(leaf), steps: merkleProof(leaves, index) } : null), [open, leaf, leaves, index]);

  return (
    <>
      <tr>
        <td className="py-2 pr-2 align-top text-zinc-700">{FILE_KIND_LABEL[leaf.file]}</td>
        <td className="py-2 pr-2 align-top">
          <p className="break-all font-mono text-xs text-zinc-800">{shortHash(leaf.hash)}</p>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-zinc-500"
          >
            <ChevronDown aria-hidden className={`size-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.5} />
            잎 해시와 증명 경로
          </button>
        </td>
        <td className="py-2 align-top text-zinc-700">{formatByteSize(leaf.byteLength)}</td>
      </tr>
      {proof && (
        <tr>
          <td colSpan={3} className="pb-3">
            <div data-surface="evidence-leaf-proof" className="rounded-card border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">전체 해시</p>
              <p className="mt-0.5 break-all font-mono text-[11px] text-zinc-800">{leaf.hash}</p>
              <p className="mt-2 text-xs text-zinc-500">잎 해시</p>
              <p className="mt-0.5 break-all font-mono text-[11px] text-zinc-800">{proof.hash}</p>
              {proof.steps.length > 0 && (
                <>
                  <p className="mt-2 text-xs text-zinc-500">루트까지의 형제 해시 (아래부터 차례로 붙여 올린다)</p>
                  <ol className="mt-0.5 space-y-1">
                    {proof.steps.map((step, position) => (
                      <li key={position} className="break-all font-mono text-[11px] text-zinc-800">
                        <span className="text-zinc-400">{step.side === "left" ? "왼쪽" : "오른쪽"} </span>
                        {step.hash}
                      </li>
                    ))}
                  </ol>
                </>
              )}
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                이 잎과 형제 해시만으로 루트가 나옵니다. 나머지 잎을 보이지 않고도 이 파일 하나가 봉인됐음을 증명할 수 있습니다.
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** 해시에 들어간 바이트 그대로의 정본 JSON. 화면이 요약하며 빠뜨린 칸이 있는지 사용자가 직접 볼 수 있게 둔다. */
function RawLeaf({ leaf }: { leaf: EvidenceLeaf }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-zinc-500"
      >
        <ChevronDown aria-hidden className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.5} />
        정본 JSON (해시에 들어간 그대로)
      </button>
      {open && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-card border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] leading-4 text-zinc-800">
          {canonicalJson(leaf)}
        </pre>
      )}
    </>
  );
}
