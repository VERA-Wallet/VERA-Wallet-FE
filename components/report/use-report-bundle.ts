"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useReportContext } from "@/components/report/report-context";
import { taxEvidenceProvider } from "@/lib/composition-root.client";
import { buildReportBundle } from "@/lib/export/report-bundle";
import { buildReportFile, type ReportFile, type ReportFileKind } from "@/lib/export/report-hash";
import { periodFilePart } from "@/lib/period";
import type { EvidenceRecord } from "@/lib/ports/tax-evidence";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import { buildEvidenceDocument, leafHash, rootOfHashes, type EvidenceDocument, type EvidenceLeaf } from "@/lib/tax/evidence";
import type { TaxEstimate } from "@/lib/tax/types";

/** 등록이 확정될 때까지 화면이 지나는 단계. `anchored`와 `failed`만 멈춘 상태다. */
export type BundlePhase = "idle" | "hashing" | "checking" | "registering" | "waiting" | "anchored" | "failed";

/**
 * 폴링 간격. 점증시켜 60초 예산 안의 요청을 40회에서 ~15회로 줄인다 —
 * `document(root)`는 잎 전체를 실어 오므로(계획 §2 비용) 간격이 곧 대역폭이다.
 * 마지막 값은 예산이 끝날 때까지 반복한다.
 */
const POLL_INTERVALS_MS = [1_500, 3_000, 5_000];
/** 스펙 AC-6의 상한. `record()`가 돌아온 순간부터 센다. */
const POLL_BUDGET_MS = 60_000;
/**
 * POST 직후 이 시간 동안 본 `failed`는 "아직 옛 라벨"로 보고 계속 기다린다.
 *
 * BE에서 `failed`는 `attempts >= 5` 뒤에 붙는 라벨이고, 재POST는 큐에 다시 넣을 뿐 라벨을
 * 즉시 되돌리지 않는다. 유예가 없으면 재시도가 누를 때마다 즉시 실패로 끝나 빠져나갈 수 없다.
 * 5초는 첫 두 폴링(1.5초·4.5초)을 덮는 길이다.
 */
const FAILED_GRACE_MS = 5_000;

/**
 * 실패 문구는 고정이다.
 *
 * BE `EvidenceView`에 `failureReason`이 없으므로 화면이 말할 수 있는 사실은 "확정되지 않았다"뿐이다.
 * 타임아웃도 같은 문구를 쓴다 — 사용자가 할 수 있는 일이 같고, 둘을 구분해도 행동이 달라지지 않는다.
 */
export const BUNDLE_FAILED_REASON = "체인에 등록하지 못했어요. 다시 시도하면 새로 등록해요.";

/** 사용자가 시키지 않았는데 계산이 갱신돼 등록이 끊겼을 때의 사유. 조용히 사라지는 것보다 낫다. */
const INTERRUPTED_REASON = "계산이 갱신되어 등록을 다시 시작해야 합니다.";

/** 만든 바이트를 그대로 저장한다. 해시를 낸 바이트와 내려받는 바이트가 다르면 등록이 무의미하다. */
function download(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/** 이 상태가 말하는 루트를 정하는 값들. 하나라도 갈리면 루트가 달라지고, 그러면 등록도 다른 등록이다. */
type BundleOwner = {
  country: string;
  taxYear: number;
  events: NormalizedEvent[];
  estimate: TaxEstimate | null;
};

type ReportBundle = ReturnType<typeof buildReportBundle>;

type BundleSnapshot = {
  phase: BundlePhase;
  record: EvidenceRecord | null;
  error: string | null;
  rejoined: boolean;
  /** 이 해의 최근 등록(`latest()` 또는 이 화면의 확정). 이것만으로는 「이 리포트가 등록됐다」가 아니다 — `latestMatch`가 답한다. */
  latest: EvidenceRecord | null;
  /**
   * `latest`의 잎. 지금 계산의 근거 잎과 맞춰 보는 재료다 — 파일 없이도 "이 계산이 등록된 것인가"를
   * 답할 수 있게 한다. null이면 아직 못 받았거나 조회가 실패한 것이다.
   */
  latestLeaves: EvidenceLeaf[] | null;
  /** 복원 조회가 도는 중. 이 동안은 "등록됐다"도 "안 됐다"도 말하지 않는다. */
  restoring: boolean;
  /** 시트가 열려 있는가. 복원 경로에서는 절대 열리지 않는다(자동 포커스가 사용자를 끌고 간다). */
  sheet: boolean;
  /** 조회는 끝났고 등록은 아직. 시트의 「내려받기」를 기다리는 자리다. */
  awaitingConfirm: boolean;
};

const IDLE: BundleSnapshot = {
  phase: "idle", record: null, error: null, rejoined: false, latest: null, latestLeaves: null, restoring: false,
  sheet: false, awaitingConfirm: false,
};

/**
 * 최근 등록이 **지금 계산**의 등록인가.
 *
 * - `same`: 등록된 근거 잎(헤더·판정)의 루트가 지금 계산의 근거 루트와 같다. 파일 잎은 계산과 원장의
 *   결정적 함수이므로 사용자에게는 "이 리포트가 등록됐다"로 말해도 된다. 탭하면 루트 전체를 한 번 더 대조한다.
 * - `different`: 등록한 뒤 계산이 바뀌었다. 다시 등록해야 한다.
 * - `unknown`: 최근 등록은 있는데 잎을 못 받았다. 단정하지 않는다.
 * - `none`: 최근 등록이 없다.
 */
export type LatestMatch = "same" | "different" | "unknown" | "none";

function evidenceRootOf(leaves: readonly EvidenceLeaf[]): string {
  return rootOfHashes(leaves.filter((leaf) => leaf.kind !== "file").map(leafHash));
}

/** 사용자가 누른 흐름이 아직 돌고 있는 단계. 이 동안 두 행이 함께 잠긴다 — 등록이 하나이므로. */
export function bundleInFlight(phase: BundlePhase): boolean {
  return phase === "hashing" || phase === "checking" || phase === "registering" || phase === "waiting";
}

export type ReportBundleState = {
  phase: BundlePhase;
  record: EvidenceRecord | null;
  error: string | null;
  /** 진행 중인 시도에 올라탄 경우. 진행 문구를 첫 시도와 다르게 말하려고 구분한다. */
  rejoined: boolean;
  /** 마지막으로 확인된 이 해·나라의 기록. 복원이 `latest()`로 채운다(파일을 만들지 않는다). */
  latestRecord: EvidenceRecord | null;
  /** `latestRecord`가 지금 계산의 등록인가. 복원 경로가 카드 한 줄을 고르는 근거다. */
  latestMatch: LatestMatch;
  /** 복원 조회 중. 카드는 「확인하고 있어요」를 보이고 행은 잠그지 않는다. */
  restoring: boolean;
  sheetOpen: boolean;
  awaitingConfirm: boolean;
  /** 행을 탭했다. 등록이 끝나면 이 종류가 함께 저장된다. */
  start: (kind: ReportFileKind) => void;
  /** 시트의 「내려받기」. 확인 단계에서 멈춘 흐름을 등록으로 이어 간다. */
  confirm: () => void;
  /** 실패 뒤 재제출. 조회를 건너뛰고 곧바로 새 시도를 연다(T6). */
  retry: () => void;
  /** 카드에 처음 닿았을 때의 복원 조회. 파일도 만들지 않고 저장도 하지 않는다. */
  restore: () => void;
  closeSheet: () => void;
};

/**
 * 리포트 한 벌의 등록 게이트.
 *
 * 내려받기는 "계산 근거와 CSV·XLSX 해시를 한 루트로 묶어 등록하고, 확정된 뒤에만 저장"한다.
 * `download()`를 부르는 자리는 셋뿐이다 — 게이트가 꺼져 있을 때, 등록할 계산이 없을 때,
 * 그리고 `anchored`로 가는 전이. 실패·타임아웃·예외에는 없다.
 *
 * 상태는 **하나다**. CSV로 시작하든 XLSX로 시작하든 같은 루트 하나를 올리므로,
 * 대기 중에 다른 행을 눌러도 재POST 없이 저장 목록(`pendingSaves`)에 더해질 뿐이다.
 *
 * 마운트만으로는 아무것도 하지 않는다. 파일 생성(XLSX는 비싸다)도 네트워크도 사용자가
 * 카드에 닿은 뒤에야 일어난다 — `restore()`가 그 첫 접촉을 받고, 그조차 파일을 만들지 않는다.
 */
export function useReportBundle(): ReportBundleState {
  const {
    events, result, freshEstimate, country, taxYear, activePeriod, gateEnabled, ready, downloadLocked, blockedReason,
  } = useReportContext();

  // `useReportContext().result`는 `TaxEstimate | undefined`다. 빌더의 계약은 `| null`이다.
  const estimate = result ?? null;

  // 상태는 **그 상태를 만든 입력과 함께** 산다. 입력이 갈리면 지금 보이는 등록 상태는 다른 루트의
  // 사실이다 — 훅은 마운트된 채 입력만 갈리므로, 버리지 않으면 새 연도의 카드가 옛 루트의
  // `anchor-done`을 말하거나 죽은 `waiting`에 걸려 행이 영영 눌리지 않는다.
  const [written, setWritten] = useState<{ owner: BundleOwner; state: BundleSnapshot }>(
    () => ({ owner: { country, taxYear, events, estimate }, state: IDLE }),
  );
  const ownerNow: BundleOwner = { country, taxYear, events, estimate };
  /** 같은 리포트인가. 나라·연도가 같으면 사용자가 보는 문서는 그대로다(계산만 갱신됐을 수 있다). */
  const sameReport = (candidate: BundleOwner) => candidate.country === country && candidate.taxYear === taxYear;
  const owns = (candidate: BundleOwner) =>
    sameReport(candidate) && candidate.events === events && candidate.estimate === estimate;

  /**
   * 입력이 갈렸을 때 이 카드가 이어받는 상태.
   *
   * - 다른 리포트(나라·연도)면 처음부터다. 옛 등록은 그 문서의 사실이다.
   * - 같은 리포트인데 계산만 갱신됐다면 사용자가 시킨 일이 아니다. 돌고 있던 등록은 루트가
   *   갈려 끊기므로, 말없이 idle로 돌아가지 않고 끊긴 사실과 사유를 남긴다.
   * - 이미 멈춘 실패는 그대로 둔다 — 루트가 바뀌었다고 "마지막으로 일어난 일"이 바뀌지는 않는다.
   * - `latest()`가 말한 최근 등록은 나라·연도의 사실이라 계산이 갱신돼도 여전히 참이다. 그 잎도
   *   함께 남긴다 — 새 계산과 다시 맞춰 보면 「계산이 바뀌어 다시 등록이 필요해요」가 저절로 나온다.
   */
  const carryOver = (previous: { owner: BundleOwner; state: BundleSnapshot }): BundleSnapshot => {
    if (!sameReport(previous.owner)) return IDLE;
    const kept: BundleSnapshot = { ...IDLE, latest: previous.state.latest, latestLeaves: previous.state.latestLeaves };
    if (bundleInFlight(previous.state.phase)) return { ...kept, phase: "failed", error: INTERRUPTED_REASON };
    return previous.state.phase === "failed" ? previous.state : kept;
  };

  const base = owns(written.owner) ? written.state : carryOver(written);
  if (!owns(written.owner)) {
    // 걸러 내기만 하면 옛 스냅샷이 저장소에 그대로 남아, 같은 키로 되돌아왔을 때(연도 왕복) 되살아난다.
    // 죽은 `waiting`이 되살아나면 폴링은 없는데 행만 영영 잠긴다. 그래서 숨기지 않고 렌더 중에 덮어쓴다 —
    // React가 권하는 "입력이 바뀔 때 상태 조정"이고, `owns()` 비교가 가드라 다음 렌더에서 멈춘다.
    setWritten({ owner: ownerNow, state: base });
  }
  const { phase, record, error, rejoined, latest, latestLeaves, restoring, sheet, awaitingConfirm } = base;

  // 대조는 잎이 오거나 계산이 바뀔 때만 다시 한다. 판정 수백 건의 해시라 렌더마다 돌릴 일은 아니다.
  const latestMatch = useMemo<LatestMatch>(() => {
    if (latest === null) return "none";
    if (latestLeaves === null || estimate === null) return "unknown";
    try {
      return evidenceRootOf(latestLeaves) === buildEvidenceDocument(estimate).merkleRoot ? "same" : "different";
    } catch {
      // 호버가 렌더를 터뜨리면 안 된다. 해시를 못 내면 모르는 것이고, 탭하면 `start()`가 우리말로 사유를 말한다.
      return "unknown";
    }
  }, [latest, latestLeaves, estimate]);

  /**
   * 이 렌더의 입력에 묶어 상태를 쓴다. 비동기가 늦게 돌아와도 그때의 입력이 찍히므로,
   * 키가 갈린 뒤의 쓰기는 다음 렌더의 `owns()`에서 다시 걸러진다.
   */
  const write = (patch: Partial<BundleSnapshot>) => {
    setWritten((previous) => ({
      owner: ownerNow,
      state: { ...(owns(previous.owner) ? previous.state : carryOver(previous)), ...patch },
    }));
  };

  // 진행 중인 흐름의 취소 플래그. 언마운트·재클릭이 이전 루프를 끈다.
  const run = useRef<{ active: boolean } | null>(null);
  // 바이트 캐시. 키는 `[events, estimate]`의 신원이다 — context가 새 값을 만들 때만 바뀐다.
  // 렌더 중에는 아무것도 만들지 않는다. `useMemo`로 옮기면 이름만 바뀐 채 마운트 비용이 그대로 남는다.
  const cache = useRef<{
    events: NormalizedEvent[];
    estimate: TaxEstimate | null;
    files: Partial<Record<ReportFileKind, ReportFile>>;
    bundle: ReportBundle | null;
  } | null>(null);
  // 확인 단계에서 멈춘 흐름. 시트의 「내려받기」가 여기서 이어받는다 — 조회를 두 번 하지 않는다.
  const paused = useRef<{ token: { active: boolean }; bundle: ReportBundle } | null>(null);
  /**
   * 등록이 끝나면 저장할 종류들. 대기 중에 다른 행을 눌러도 "무시"도 "새 등록"도 답이 아니다 —
   * 같은 루트가 이미 올라가는 중이니 저장 목록에 더하는 것이 맞다.
   */
  const pendingSaves = useRef<Set<ReportFileKind>>(new Set());
  // 복원은 이 카드에서 한 번뿐이다. 호버를 반복해도 조회는 늘지 않는다.
  const restored = useRef(false);
  const mounted = useRef(true);
  // 흐름의 세대. `start()`와 키 교체가 올린다. `restore()`는 취소 토큰을 만들지 않으므로
  // 이 값으로 "내가 연 조회가 아직 이 카드의 사실인가"를 묻는다.
  const seq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (run.current) run.current.active = false;
    };
  }, []);

  // 화면에서 걸러 내는 것만으로는 부족하다 — 옛 입력의 흐름은 계속 돌면서 폴링을 내고, 확정되면
  // 이제는 만들지도 않을 파일을 저장한다. 그래서 그 입력의 **마지막 렌더가 끝나는 자리**에서 끊는다.
  // 정리 함수라 setState가 없다(효과 본문의 setState는 연쇄 렌더를 부른다).
  useEffect(
    () => () => {
      if (run.current) run.current.active = false;
      run.current = null;
      paused.current = null;
      // 옛 리포트의 파일을 새 등록이 저장하면 안 된다.
      pendingSaves.current.clear();
      seq.current += 1;
    },
    [country, taxYear, events, estimate],
  );

  // 복원은 나라·연도의 사실(`latest`)만 묻는다. 계산이 갱신됐다고 그 답이 달라지지는 않으므로
  // 이 플래그는 리포트가 바뀔 때만 열린다 — 배경 재조회마다 조회를 한 번씩 더 내지 않는다.
  useEffect(() => () => { restored.current = false; }, [country, taxYear]);

  const slots = () => {
    const current = cache.current;
    if (current && current.events === events && current.estimate === estimate) return current;
    const next = { events, estimate, files: {} as Partial<Record<ReportFileKind, ReportFile>>, bundle: null };
    cache.current = next;
    return next;
  };

  const fileFor = (kind: ReportFileKind): ReportFile => {
    const current = slots();
    const cached = current.files[kind];
    if (cached) return cached;
    const file = buildReportFile(kind, events, estimate);
    current.files[kind] = file;
    return file;
  };

  /** 계산 근거 + 파일 둘을 한 루트로. 해시한 바이트가 곧 저장할 바이트다(`files`를 함께 들고 온다). */
  const bundleFor = (current: TaxEstimate): ReportBundle => {
    const slot = slots();
    if (slot.bundle) return slot.bundle;
    const bundle = buildReportBundle(current, events);
    slot.bundle = bundle;
    slot.files.csv = bundle.files.csv;
    slot.files.xlsx = bundle.files.xlsx;
    return bundle;
  };

  const save = (file: ReportFile) => {
    // 파일명 규칙은 게이트 전과 같다. 등록이 파일 이름을 바꾸지는 않는다.
    const period = activePeriod ? periodFilePart(activePeriod) : "기간";
    // `Uint8Array`의 기본 버퍼 타입(`ArrayBufferLike`)이 `BlobPart`의 `ArrayBufferView<ArrayBuffer>`보다 넓다.
    // 이 바이트는 `TextEncoder`·`new Uint8Array(ArrayBuffer)`가 낸 것이라 공유 버퍼가 아니다.
    download(file.bytes as BlobPart, file.mimeType, `verawallet-신고근거-${period}.${file.kind}`);
  };

  const flushSaves = () => {
    const kinds = [...pendingSaves.current];
    pendingSaves.current.clear();
    for (const kind of kinds) save(fileFor(kind));
  };

  /**
   * 확정. 이 등록은 곧 이 해의 최근 등록이기도 하므로 `latest`와 잎을 함께 적는다 — 나중에 계산만
   * 갱신돼 `anchored`가 버려져도 카드는 "등록한 뒤 계산이 바뀌었다"를 말할 수 있다.
   */
  const settle = (next: EvidenceRecord, leaves: EvidenceLeaf[]) => {
    write({ record: next, error: null, phase: "anchored", awaitingConfirm: false, latest: next, latestLeaves: leaves });
    flushSaves();
  };

  const fail = (reason: string, next: EvidenceRecord | null) => {
    // 시트를 억지로 열지 않는다 — 「백그라운드에서 계속」을 고른 사용자 앞에 대화상자를 띄우지 않는다.
    // 카드 상단 줄이 `aria-live`로 같은 사실을 말하고, 「다시 시도」도 거기에 있다.
    write({ ...(next ? { record: next } : {}), error: reason, phase: "failed", awaitingConfirm: false });
  };

  /**
   * 확정을 기다린다. 조회는 `latest()`가 아니라 **루트 기준 `document(root)`**다 —
   * `latest()`는 `createdAt` 내림차순인데 BE `save`는 같은 루트를 다시 받아도 기존 기록을 그대로
   * 돌려주므로(`createdAt` 갱신 없음), 계산을 고쳤다 되돌린 사용자는 "내 루트와 다르다"를
   * 영원히 보고 60초 뒤 타임아웃한다. 이미 체인에 올라가 있는데도 파일이 안 나간다.
   *
   * `postedAt`이 null이면 이 흐름에서 POST를 내지 않았다는 뜻이다(진행 중인 시도에 재합류).
   * 그때는 유예 창이 없다 — 우리가 큐에 다시 넣은 것이 아니므로 `failed`는 그대로 실패다.
   */
  const poll = async (token: { active: boolean }, bundle: ReportBundle, postedAt: number | null) => {
    const root = bundle.merkleRoot;
    const startedAt = postedAt ?? Date.now();
    let step = 0;
    while (token.active) {
      await sleep(POLL_INTERVALS_MS[Math.min(step, POLL_INTERVALS_MS.length - 1)]);
      step += 1;
      if (!token.active) return;
      const next = await taxEvidenceProvider.document(root);
      if (!token.active) return;
      if (next) write({ record: next });
      if (next?.anchorStatus === "anchored") { settle(next, bundle.leaves); return; }
      if (next?.anchorStatus === "failed" && (postedAt === null || Date.now() - postedAt >= FAILED_GRACE_MS)) {
        fail(BUNDLE_FAILED_REASON, next);
        return;
      }
      // 예산은 이 시도의 시작부터 센다. 떠났다 돌아온 사용자가 앞선 대기 때문에 즉시 타임아웃을 보지 않게 한다.
      if (Date.now() - startedAt >= POLL_BUDGET_MS) { fail(BUNDLE_FAILED_REASON, next); return; }
    }
  };

  const register = async (token: { active: boolean }, bundle: ReportBundle) => {
    try {
      // `files`는 화면이 저장할 바이트지 계약의 일부가 아니다. 문서만 올린다.
      const evidence: EvidenceDocument = { version: bundle.version, merkleRoot: bundle.merkleRoot, leaves: bundle.leaves };
      const next = await taxEvidenceProvider.record(evidence);
      if (!token.active) return;
      const postedAt = Date.now();
      write({ record: next });
      if (next.anchorStatus === "anchored") { settle(next, bundle.leaves); return; }
      // `failed`가 돌아와도 곧바로 실패로 보지 않는다 — 재POST는 큐에 다시 넣을 뿐 라벨을 되돌리지 않는다.
      write({ phase: "waiting" });
      await poll(token, bundle, postedAt);
    } catch (cause: unknown) {
      if (!token.active) return;
      fail(cause instanceof Error ? cause.message : BUNDLE_FAILED_REASON, null);
    }
  };

  /** 새 흐름의 취소 토큰. 이전 흐름은 여기서 끊긴다. */
  const openToken = () => {
    if (run.current) run.current.active = false;
    const token = { active: true };
    run.current = token;
    seq.current += 1;
    return token;
  };

  const start = (kind: ReportFileKind) => {
    // 탭이 카드로 전파돼 `restore()`가 이어 불려도(`phase`는 아직 이 렌더의 "idle"이다) 조회가
    // 둘이 되지 않게 먼저 플래그를 세운다. 누른 사람에게는 `latest()`의 "최근 등록"보다
    // 루트를 맞춘 사실이 곧 도착한다.
    restored.current = true;

    // 게이트가 꺼져 있으면 해시도 네트워크도 없다. 예전 내려받기와 같은 바이트가 그대로 나간다.
    // 계산이 없는 기간도 같은 길을 탄다 — 등록할 근거가 없는 파일을 붙잡아 두는 것은 게이트의 취지가 아니다.
    if (!gateEnabled || estimate === null) { save(fileFor(kind)); return; }

    pendingSaves.current.add(kind);
    if (bundleInFlight(phase)) {
      // 같은 루트가 이미 올라가는 중이다. 새 POST는 없고, 저장 목록에 더해진 것으로 끝이다.
      write({ sheet: true });
      return;
    }
    if (phase === "anchored") {
      // 이 계산의 루트는 이미 확정됐다. 어느 파일이든 탭하면 바로 저장이다 — 시트도 열지 않는다.
      flushSaves();
      return;
    }
    // 확인 단계에서 멈췄거나 실패로 끝난 흐름은 다시 묻지 않는다. 시트를 열어 그 자리를 보인다.
    if ((awaitingConfirm && paused.current !== null) || phase === "failed") { write({ sheet: true }); return; }

    const token = openToken();
    // `openToken()`이 세대를 올려 돌고 있던 복원은 결과를 버린다. 그 플래그도 여기서 내린다.
    write({ error: null, rejoined: false, phase: "hashing", awaitingConfirm: false, sheet: false, restoring: false });
    void (async () => {
      try {
        let bundle: ReportBundle;
        try {
          bundle = bundleFor(estimate);
        } catch (cause: unknown) {
          // 파일을 만들다 던진 것은 등록 실패가 아니라 파일 문제다(예: 셀 한도 초과). 라이브러리의 영문
          // 메시지를 그대로 내보내지 않고, 무슨 단계에서 막혔는지 우리말로 말한다.
          const detail = cause instanceof Error ? cause.message : String(cause);
          throw new Error(`파일을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요. (${detail})`);
        }
        if (!token.active) return;
        write({ phase: "checking" });
        const existing = await taxEvidenceProvider.document(bundle.merkleRoot);
        if (!token.active) return;
        if (existing?.anchorStatus === "anchored") { settle(existing, bundle.leaves); return; }
        if (existing?.anchorStatus === "pending") {
          // 진행 중인 시도에 올라탄다. 여기서 POST를 내면 트랜잭션이 둘이 된다.
          write({ record: existing, rejoined: true, phase: "waiting", sheet: true });
          await poll(token, bundle, null);
          return;
        }
        // 기록이 없거나(`null`) 지난 시도가 소진됐으면(`failed`) 새 등록이다. 둘 다 사용자가
        // 시트에서 확인할 때까지 멈춘다 — 탭 한 번이 곧 트랜잭션이 되지 않게.
        paused.current = { token, bundle };
        write({ phase: "idle", awaitingConfirm: true, sheet: true });
      } catch (cause: unknown) {
        if (!token.active) return;
        fail(cause instanceof Error ? cause.message : BUNDLE_FAILED_REASON, null);
      }
    })();
  };

  const confirm = () => {
    const resume = paused.current;
    if (resume === null || !resume.token.active) return;
    paused.current = null;
    write({ phase: "registering", awaitingConfirm: false, error: null });
    void register(resume.token, resume.bundle);
  };

  const retry = () => {
    if (!gateEnabled || estimate === null) return;
    paused.current = null;
    restored.current = true;
    const token = openToken();
    write({ error: null, rejoined: false, phase: "registering", awaitingConfirm: false, restoring: false });
    void (async () => {
      // 조회를 건너뛴다. 지난 시도가 `failed`로 남아 있는 것을 이미 알고 있고, 재POST가 새 시도를 연다(T6).
      const bundle = bundleFor(estimate);
      if (!token.active) return;
      await register(token, bundle);
    })();
  };

  const restore = () => {
    if (restored.current || phase !== "idle" || run.current?.active === true) return;
    // 잠겼거나 만들 수 없는 파일은 물어볼 이유도 없다. 지갑 미연결은 `blockedReason`이 이미 덮는다.
    if (!gateEnabled || !ready || downloadLocked || blockedReason !== null) return;
    // 등록할 계산이 없는 기간은 게이트 자체가 걸리지 않는다. 조회도 하지 않는다.
    if (estimate === null) return;
    // 계산이 아직 오는 중이면 이 카드가 말할 사실이 곧 달라진다. 도착한 뒤 한 번 묻는다.
    if (freshEstimate.state === "pending") return;
    restored.current = true;
    // 조회가 도는 동안 사용자가 행을 눌러 흐름이 끝났을 수 있다. 느린 복원이 뒤늦게 돌아와
    // 그 결론을 덮지 않도록 시작 시점의 세대를 들고 간다.
    const mySeq = seq.current;
    const stale = () => !mounted.current || seq.current !== mySeq;
    write({ restoring: true });
    void (async () => {
      try {
        const existing = await taxEvidenceProvider.latest(country, taxYear);
        if (stale()) return;
        // 확정된 기록만 본다. 이 한 줄은 아직 「최근 등록」이다 — 「이 리포트가 등록됨」은 잎을 맞춰 본 뒤에야 말한다.
        if (existing?.anchorStatus !== "anchored") { write({ restoring: false }); return; }
        write({ latest: existing });
        // 잎을 받아 지금 계산의 근거 잎과 맞춘다(`latestMatch`). 파일은 여전히 만들지 않는다 —
        // 헤더·판정 잎만으로 "이 계산이 등록된 것인가"는 답할 수 있고, 파일 잎은 탭할 때 루트로 확인한다.
        const detail = await taxEvidenceProvider.document(existing.merkleRoot);
        if (stale()) return;
        write({ latestLeaves: detail?.leaves ?? null, restoring: false });
      } catch {
        // 복원 실패는 행을 막지 않는다. 누르면 루트로 다시 묻는다.
        if (!stale()) write({ restoring: false });
      }
    })();
  };

  return {
    phase,
    record,
    error,
    rejoined,
    latestRecord: latest,
    latestMatch,
    restoring,
    sheetOpen: sheet,
    awaitingConfirm,
    start,
    confirm,
    retry,
    restore,
    closeSheet: () => write({ sheet: false }),
  };
}
