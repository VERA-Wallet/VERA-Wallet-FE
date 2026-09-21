"use client";

import { useEffect, useRef, useState } from "react";

import { useReportContext } from "@/components/report/report-context";
import { reportAnchorProvider } from "@/lib/composition-root.client";
import { buildReportFile, type ReportFile } from "@/lib/export/report-hash";
import { periodFilePart } from "@/lib/period";
import type { ReportAnchorKey, ReportAnchorKind, ReportAnchorRecord } from "@/lib/ports/report-anchor";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";
import type { TaxEstimate } from "@/lib/tax/types";

/** 등록이 확정될 때까지 화면이 지나는 단계. `anchored`와 `failed`만 멈춘 상태다. */
export type AnchorPhase = "idle" | "hashing" | "checking" | "registering" | "waiting" | "anchored" | "failed";

const POLL_INTERVAL_MS = 1_500;
/** 스펙 AC-6의 상한. 넘으면 파일을 내보내지 않고 "제한 시간" 사유로 끝낸다. */
const POLL_TIMEOUT_MS = 60_000;

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

/** 이 상태가 말하는 파일을 정하는 값들. 하나라도 갈리면 파일이 달라지고, 그러면 등록도 다른 등록이다. */
type AnchorOwner = {
  kind: ReportAnchorKind;
  country: string;
  taxYear: number;
  events: NormalizedEvent[];
  estimate: TaxEstimate | null;
};

type AnchorSnapshot = Pick<ReportAnchorState, "phase" | "record" | "error" | "rejoined">;

const IDLE: AnchorSnapshot = { phase: "idle", record: null, error: null, rejoined: false };

/** 사용자가 누른 흐름이 아직 돌고 있는 단계. 이 동안 버튼은 눌리지 않고, 파일이 갈리면 이 흐름이 끊긴다. */
export function anchorInFlight(phase: AnchorPhase): boolean {
  return phase === "hashing" || phase === "checking" || phase === "registering" || phase === "waiting";
}

/** 사용자가 시키지 않았는데 계산이 갱신돼 등록이 끊겼을 때의 사유. 조용히 사라지는 것보다 낫다. */
const INTERRUPTED_REASON = "계산이 갱신되어 등록을 다시 시작해야 합니다.";

export type ReportAnchorState = {
  phase: AnchorPhase;
  record: ReportAnchorRecord | null;
  error: string | null;
  /** 언마운트 뒤 돌아와 진행 중인 시도에 올라탄 경우. 진행 문구를 첫 시도와 다르게 말하려고 구분한다. */
  rejoined: boolean;
  /** 버튼을 누른 흐름: 파일 생성 → 해시 → 조회 → (필요하면) 등록 → 폴링 → 저장. */
  start: () => void;
  /** 실패 뒤 재제출. 같은 흐름을 다시 탄다(조회에서 `failed`를 보고 새 시도를 연다). */
  retry: () => void;
  /** 카드에 처음 닿았을 때의 복원 조회. 저장은 하지 않는다 — 사용자가 누르지 않았다. */
  restore: () => void;
};

/**
 * 파일 하나(CSV 또는 XLSX)의 등록 게이트.
 *
 * 내려받기는 "파일을 만들어 그 바이트의 해시를 등록하고, 등록이 확정된 뒤에만 저장"한다.
 * `download()`를 부르는 자리는 딱 둘이다 — 게이트가 꺼져 있을 때와 `anchored`로 가는 전이.
 * 실패·타임아웃·예외에는 없다. 파일이 나갔는데 등록이 없는 상태를 만들지 않는 것이 이 게이트의 전부다.
 *
 * 마운트만으로는 아무것도 하지 않는다. 파일 생성(XLSX는 비싸다)도 네트워크도 사용자가
 * 카드에 닿은 뒤에야 일어난다 — `restore()`가 그 첫 접촉을 받는다.
 */
export function useReportAnchor(kind: ReportAnchorKind): ReportAnchorState {
  const { events, result, freshEstimate, country, taxYear, activePeriod, gateEnabled, ready, downloadLocked, blockedReason } = useReportContext();

  // `useReportContext().result`는 `TaxEstimate | undefined`다. 파일 빌더의 계약은 `| null`이다.
  const estimate = result ?? null;

  // 상태는 **그 상태를 만든 입력과 함께** 산다. 입력이 갈리면 지금 보이는 등록 상태는 다른 파일의
  // 사실이다 — 훅은 마운트된 채 입력만 갈리므로, 버리지 않으면 새 연도의 카드가 옛 파일의
  // `anchor-done`을 말하거나 죽은 `waiting`·`failed`에 걸려 버튼이 영영 눌리지 않는다.
  // 비교 기준은 바이트 캐시(`cache`)와 같은 신원이어야 "파일이 같으면 상태도 같다"가 성립한다.
  const [written, setWritten] = useState<{ owner: AnchorOwner; state: AnchorSnapshot }>(
    () => ({ owner: { kind, country, taxYear, events, estimate }, state: IDLE }),
  );
  const ownerNow: AnchorOwner = { kind, country, taxYear, events, estimate };
  /** 같은 문서인가. 연도·나라·종류가 같으면 사용자가 보는 리포트는 그대로다(계산만 갱신됐을 수 있다). */
  const sameReport = (candidate: AnchorOwner) =>
    candidate.kind === kind && candidate.country === country && candidate.taxYear === taxYear;
  const owns = (candidate: AnchorOwner) =>
    sameReport(candidate) && candidate.events === events && candidate.estimate === estimate;

  /**
   * 입력이 갈렸을 때 이 카드가 이어받는 상태.
   *
   * - 다른 리포트(연도·나라·종류)면 처음부터다. 사용자가 다른 문서를 연 것이고, 옛 등록은 그 문서의 사실이다.
   * - 같은 리포트인데 계산만 갱신됐다면(백그라운드 `["tax"]` 재조회 등) 사용자가 시킨 일이 아니다.
   *   돌고 있던 등록은 파일이 갈려 끊기므로, 말없이 idle로 돌아가지 않고 끊긴 사실과 사유를 남긴다.
   * - 이미 멈춘 실패는 그대로 둔다 — 파일이 바뀌었다고 "마지막으로 일어난 일"이 바뀌지는 않는다.
   */
  const carryOver = (previous: { owner: AnchorOwner; state: AnchorSnapshot }): AnchorSnapshot => {
    if (!sameReport(previous.owner)) return IDLE;
    if (anchorInFlight(previous.state.phase)) return { ...IDLE, phase: "failed", error: INTERRUPTED_REASON };
    return previous.state.phase === "failed" ? previous.state : IDLE;
  };

  const base = owns(written.owner) ? written.state : carryOver(written);
  if (!owns(written.owner)) {
    // 걸러 내기만 하면 옛 스냅샷이 저장소에 그대로 남아, 같은 키로 되돌아왔을 때(연도 왕복) 되살아난다.
    // 죽은 `waiting`이 되살아나면 폴링은 없는데 버튼만 "체인에 등록하는 중…"으로 영영 잠긴다.
    // 그래서 숨기지 않고 렌더 중에 덮어쓴다 — React가 권하는 "입력이 바뀔 때 상태 조정"이고,
    // `owns()` 비교가 가드라 바로 다음 렌더에서 멈춘다.
    setWritten({ owner: ownerNow, state: base });
  }
  const { phase, record, error, rejoined } = base;

  /**
   * 이 렌더의 입력에 묶어 상태를 쓴다. 비동기가 늦게 돌아와도 그때의 입력이 찍히므로,
   * 키가 갈린 뒤의 쓰기는 다음 렌더의 `owns()`에서 다시 걸러진다.
   */
  const write = (patch: Partial<AnchorSnapshot>) => {
    setWritten((previous) => ({
      owner: ownerNow,
      state: { ...(owns(previous.owner) ? previous.state : carryOver(previous)), ...patch },
    }));
  };

  // 진행 중인 흐름의 취소 플래그. 언마운트·재클릭이 이전 루프를 끈다.
  const run = useRef<{ active: boolean } | null>(null);
  // 바이트 캐시. 키는 `[kind, events, estimate]`의 신원이다 — context가 새 값을 만들 때만 바뀐다.
  // 렌더 중에는 아무것도 만들지 않는다. `useMemo`로 옮기면 이름만 바뀐 채 마운트 비용이 그대로 남는다.
  const cache = useRef<{ kind: ReportAnchorKind; events: NormalizedEvent[]; estimate: TaxEstimate | null; file: ReportFile } | null>(null);
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
  // 정리 함수라 setState가 없다(효과 본문의 setState는 연쇄 렌더를 부른다). 복원 플래그도 같이 열어
  // 새 키의 카드가 다시 한 번 조회할 수 있게 한다.
  useEffect(
    () => () => {
      if (run.current) run.current.active = false;
      run.current = null;
      seq.current += 1;
      restored.current = false;
    },
    [kind, country, taxYear, events, estimate],
  );

  const fileFor = (): ReportFile => {
    const cached = cache.current;
    if (cached && cached.kind === kind && cached.events === events && cached.estimate === estimate) return cached.file;
    const file = buildReportFile(kind, events, estimate);
    cache.current = { kind, events, estimate, file };
    return file;
  };

  const keyFor = (file: ReportFile): ReportAnchorKey => ({
    fileHash: file.hash,
    kind,
    // context는 정규화된 코드를 `country`로 노출한다. 계약(DTO)에서의 이름은 `countryCode`다.
    countryCode: country,
    taxYear,
  });

  const save = (file: ReportFile) => {
    // 파일명 규칙은 게이트 전과 같다. 등록이 파일 이름을 바꾸지는 않는다.
    const period = activePeriod ? periodFilePart(activePeriod) : "기간";
    // `Uint8Array`의 기본 버퍼 타입(`ArrayBufferLike`)이 `BlobPart`의 `ArrayBufferView<ArrayBuffer>`보다 넓다.
    // 이 바이트는 `TextEncoder`·`new Uint8Array(ArrayBuffer)`가 낸 것이라 공유 버퍼가 아니다.
    download(file.bytes as BlobPart, file.mimeType, `verawallet-신고근거-${period}.${kind}`);
  };

  const settle = (next: ReportAnchorRecord, file: ReportFile) => {
    write({ record: next, error: null, phase: "anchored" });
    save(file);
  };

  const fail = (reason: string, next: ReportAnchorRecord | null) => {
    write({ ...(next ? { record: next } : {}), error: reason, phase: "failed" });
  };

  const poll = async (token: { active: boolean }, key: ReportAnchorKey, file: ReportFile) => {
    const startedAt = Date.now();
    while (token.active) {
      await sleep(POLL_INTERVAL_MS);
      if (!token.active) return;
      const next = await reportAnchorProvider.get(key);
      if (!token.active) return;
      if (next) write({ record: next });
      if (next?.anchorStatus === "anchored") { settle(next, file); return; }
      if (next?.anchorStatus === "failed") { fail(next.failureReason ?? "등록에 실패했습니다.", next); return; }
      // 예산은 이 시도의 시작부터 센다. 떠났다 돌아온 사용자가 앞선 대기 때문에 즉시 타임아웃을 보지 않게 한다.
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        fail("등록이 제한 시간 안에 확정되지 않았습니다.", next);
        return;
      }
    }
  };

  const start = () => {
    if (anchorInFlight(phase)) return;
    if (run.current) run.current.active = false;
    const token = { active: true };
    run.current = token;
    seq.current += 1;
    // 이 흐름이 같은 키를 조회한다. 복원은 더 할 일이 없다 — 클릭이 카드로 전파돼 `restore()`가
    // 이어 불려도(`phase`는 아직 이 렌더의 "idle"이다) 조회가 둘이 되지 않게 여기서 플래그를 세운다.
    restored.current = true;

    // 게이트가 꺼져 있으면 해시도 네트워크도 없다. 예전 내려받기와 같은 바이트가 그대로 나간다.
    if (!gateEnabled) {
      save(fileFor());
      return;
    }

    write({ error: null, rejoined: false, phase: "hashing" });
    void (async () => {
      try {
        const file = fileFor();
        const key = keyFor(file);
        if (!token.active) return;
        write({ phase: "checking" });
        const existing = await reportAnchorProvider.get(key);
        if (!token.active) return;
        if (existing?.anchorStatus === "anchored") { settle(existing, file); return; }
        if (existing?.anchorStatus === "pending") {
          // 진행 중인 시도에 올라탄다. 여기서 POST를 내면 트랜잭션이 둘이 된다.
          write({ record: existing, rejoined: true, phase: "waiting" });
          await poll(token, key, file);
          return;
        }
        // 기록이 없거나(`null`) 지난 시도가 소진됐으면(`failed`) 새 시도를 연다.
        write({ phase: "registering" });
        const next = await reportAnchorProvider.register({
          version: 1,
          algorithm: file.algorithm,
          fileHash: file.hash,
          kind,
          countryCode: country,
          taxYear,
          byteLength: file.bytes.byteLength,
        });
        if (!token.active) return;
        write({ record: next });
        if (next.anchorStatus === "anchored") { settle(next, file); return; }
        if (next.anchorStatus === "failed") { fail(next.failureReason ?? "등록에 실패했습니다.", next); return; }
        write({ phase: "waiting" });
        await poll(token, key, file);
      } catch (cause: unknown) {
        if (!token.active) return;
        fail(cause instanceof Error ? cause.message : "파일을 등록하지 못했습니다.", null);
      }
    })();
  };

  const restore = () => {
    if (restored.current || phase !== "idle" || run.current?.active === true) return;
    // 잠겼거나 만들 수 없는 파일은 조회할 이유도 없다. 지갑 미연결은 `blockedReason`이 이미 덮는다.
    if (!gateEnabled || !ready || downloadLocked || blockedReason !== null) return;
    // 계산이 아직 오는 중이면 지금 만든 파일은 곧 다른 파일이 된다. 그 해시로 묻는 조회는
    // 답이 무엇이든 이 카드의 사실이 아니다 — 계산이 도착한 뒤 새 키로 한 번 묻는다.
    if (freshEstimate.state === "pending") return;
    restored.current = true;
    // 조회가 도는 동안 사용자가 버튼을 눌러 흐름이 끝났을 수 있다. 느린 복원이 뒤늦게 돌아와
    // 그 결론(예: `failed`)을 `anchored`로 덮지 않도록 시작 시점의 세대를 들고 간다.
    const mySeq = seq.current;
    void (async () => {
      try {
        const file = fileFor();
        const existing = await reportAnchorProvider.get(keyFor(file));
        if (!mounted.current || seq.current !== mySeq) return;
        // 확정된 기록만 한 줄로 말한다. 진행 중·실패는 사용자가 누른 흐름에서만 보인다.
        if (existing?.anchorStatus === "anchored") write({ record: existing, phase: "anchored" });
      } catch {
        // 복원 실패는 버튼을 막지 않는다. 누르면 같은 조회를 다시 탄다.
      }
    })();
  };

  return { phase, record, error, rejoined, start, retry: start, restore };
}
