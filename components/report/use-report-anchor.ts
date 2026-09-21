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
  const { events, result, country, taxYear, activePeriod, gateEnabled, ready, downloadLocked, blockedReason } = useReportContext();

  const [phase, setPhase] = useState<AnchorPhase>("idle");
  const [record, setRecord] = useState<ReportAnchorRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejoined, setRejoined] = useState(false);

  // 진행 중인 흐름의 취소 플래그. 언마운트·재클릭이 이전 루프를 끈다.
  const run = useRef<{ active: boolean } | null>(null);
  // 바이트 캐시. 키는 `[kind, events, estimate]`의 신원이다 — context가 새 값을 만들 때만 바뀐다.
  // 렌더 중에는 아무것도 만들지 않는다. `useMemo`로 옮기면 이름만 바뀐 채 마운트 비용이 그대로 남는다.
  const cache = useRef<{ kind: ReportAnchorKind; events: NormalizedEvent[]; estimate: TaxEstimate | null; file: ReportFile } | null>(null);
  // 복원은 이 카드에서 한 번뿐이다. 호버를 반복해도 조회는 늘지 않는다.
  const restored = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (run.current) run.current.active = false;
    };
  }, []);

  // `useReportContext().result`는 `TaxEstimate | undefined`다. 파일 빌더의 계약은 `| null`이다.
  const estimate = result ?? null;

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
    setRecord(next);
    setError(null);
    setPhase("anchored");
    save(file);
  };

  const fail = (reason: string, next: ReportAnchorRecord | null) => {
    if (next) setRecord(next);
    setError(reason);
    setPhase("failed");
  };

  const poll = async (token: { active: boolean }, key: ReportAnchorKey, file: ReportFile) => {
    const startedAt = Date.now();
    while (token.active) {
      await sleep(POLL_INTERVAL_MS);
      if (!token.active) return;
      const next = await reportAnchorProvider.get(key);
      if (!token.active) return;
      if (next) setRecord(next);
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
    if (phase === "hashing" || phase === "checking" || phase === "registering" || phase === "waiting") return;
    if (run.current) run.current.active = false;
    const token = { active: true };
    run.current = token;
    // 이 흐름이 같은 키를 조회한다. 복원은 더 할 일이 없다 — 클릭이 카드로 전파돼 `restore()`가
    // 이어 불려도(`phase`는 아직 이 렌더의 "idle"이다) 조회가 둘이 되지 않게 여기서 플래그를 세운다.
    restored.current = true;

    // 게이트가 꺼져 있으면 해시도 네트워크도 없다. 예전 내려받기와 같은 바이트가 그대로 나간다.
    if (!gateEnabled) {
      save(fileFor());
      return;
    }

    setError(null);
    setRejoined(false);
    setPhase("hashing");
    void (async () => {
      try {
        const file = fileFor();
        const key = keyFor(file);
        if (!token.active) return;
        setPhase("checking");
        const existing = await reportAnchorProvider.get(key);
        if (!token.active) return;
        if (existing?.anchorStatus === "anchored") { settle(existing, file); return; }
        if (existing?.anchorStatus === "pending") {
          // 진행 중인 시도에 올라탄다. 여기서 POST를 내면 트랜잭션이 둘이 된다.
          setRecord(existing);
          setRejoined(true);
          setPhase("waiting");
          await poll(token, key, file);
          return;
        }
        // 기록이 없거나(`null`) 지난 시도가 소진됐으면(`failed`) 새 시도를 연다.
        setPhase("registering");
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
        setRecord(next);
        if (next.anchorStatus === "anchored") { settle(next, file); return; }
        if (next.anchorStatus === "failed") { fail(next.failureReason ?? "등록에 실패했습니다.", next); return; }
        setPhase("waiting");
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
    restored.current = true;
    void (async () => {
      try {
        const file = fileFor();
        const existing = await reportAnchorProvider.get(keyFor(file));
        if (!mounted.current) return;
        // 확정된 기록만 한 줄로 말한다. 진행 중·실패는 사용자가 누른 흐름에서만 보인다.
        if (existing?.anchorStatus === "anchored") {
          setRecord(existing);
          setPhase("anchored");
        }
      } catch {
        // 복원 실패는 버튼을 막지 않는다. 누르면 같은 조회를 다시 탄다.
      }
    })();
  };

  return { phase, record, error, rejoined, start, retry: start, restore };
}
