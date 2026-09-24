"use client";

import { CircleCheck, FileBadge } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Notice, PRIMARY_BUTTON, QrPanel, SECONDARY_BUTTON, SessionExpiredNotice, Spinner } from "@/components/report-vc/primitives";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import { formatDateTime } from "@/lib/format";
import type { Provenance } from "@/lib/http/envelope";
import type { ReportVcClient } from "@/lib/report-vc/client";
import { useReportVcClient } from "@/lib/report-vc/composition";
import { CREDENTIAL_NAME, describeError, isFeatureUnavailable, isNetworkFailure, isSessionExpired } from "@/lib/report-vc/messages";
import { startPolling } from "@/lib/report-vc/poll";
import { ReportVcError, type EvidenceIssuanceState, type IssuanceOffer, type IssuanceSettled, type IssuanceView } from "@/lib/report-vc/types";
import { newIdempotencyKey } from "@/lib/report-vc/use-countdown";

/**
 * "VC로 받기" 카드. 계산 근거 기록 카드(`components/report/evidence-anchor.tsx`) 안에 산다.
 *
 * 발급 대상은 이미 체인에 기록된 근거다. 이 카드는 근거의 **식별자**(`evidenceId`, 현재는 기록의 머클루트)만
 * 서버에 보내고, 소유권·기록 내용·금액·DID는 BE가 저장된 값으로 확인한다. FE가 계산한 값을
 * 권위 있는 값으로 보내지 않는다.
 *
 * 완료는 서버가 `issued`를 돌려줄 때다. QR을 그린 것은 발급 제안이지 발급이 아니다.
 * 사용하지 않는 TaxReport/finalize 흐름은 연결하지 않는다.
 */
type Phase =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "session_expired" }
  | { kind: "idle"; state: EvidenceIssuanceState; notice?: { tone: "info" | "warn" | "error"; message: string } }
  | { kind: "requesting"; state: EvidenceIssuanceState }
  | { kind: "presenting"; state: EvidenceIssuanceState; offer: IssuanceOffer; waiting: "offer_ready" | "issuing" }
  | { kind: "issued"; state: EvidenceIssuanceState; issuance: IssuanceSettled };

const ELIGIBILITY_TEXT: Record<Exclude<EvidenceIssuanceState["eligibility"], "ready">, { title: string; body: string; tone: "info" | "warn" | "error" }> = {
  wallet_unlinked: { tone: "info", title: "증명서 지갑을 먼저 연결하세요", body: "설정에서 Open DID 증명서 지갑을 연결하면 이 근거를 증명서로 받을 수 있습니다." },
  anchor_pending: { tone: "info", title: "체인 기록을 기다리고 있습니다", body: "기록이 체인에 실린 뒤에 발급을 요청할 수 있습니다. 잠시 뒤 이 화면을 다시 여세요." },
  anchor_failed: { tone: "error", title: "체인 기록에 실패했습니다", body: "내려받기에서 다시 등록하면 새 기록으로 발급을 요청할 수 있습니다." },
  anchor_missing: { tone: "warn", title: "이 계정의 기록을 찾지 못했습니다", body: "내려받기로 계산 근거를 다시 등록한 뒤 시도하세요." },
  disabled: { tone: "info", title: "발급 기능이 꺼져 있습니다", body: "지금은 증명서 발급을 지원하지 않습니다." },
};

function issuedLine(issuance: IssuanceView): string {
  const when = issuance.issuedAt ?? issuance.createdAt;
  return `${formatDateTime(when)}${issuance.version !== undefined ? ` · 버전 ${issuance.version}` : ""}`;
}

export function ReportVcIssueCard({ evidenceId, stale = false, client: override }: { evidenceId: string; stale?: boolean; client?: ReportVcClient }) {
  const client = useReportVcClient(override);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [provenance, setProvenance] = useState<Provenance>("live");
  const generation = useRef(0);
  const stopPolling = useRef<() => void>(() => {});
  const busy = useRef(false);
  // 사용자의 "발급 요청" 한 번에 키 하나. 응답을 못 받은 재전송에는 같은 키를 쓰고, 종결 뒤 새 시도는 새 키다.
  const idempotencyKey = useRef<string | null>(null);

  const loadState = useCallback(async (gen: number, signal?: AbortSignal): Promise<EvidenceIssuanceState | null> => {
    if (!client) return null;
    const capabilities = await client.capabilities(signal);
    if (generation.current !== gen) return null;
    if (!capabilities.data.enabled || !capabilities.data.issuance) {
      setPhase({ kind: "unavailable", message: "증명서 발급 기능이 아직 준비되지 않았습니다." });
      return null;
    }
    const state = await client.evidenceIssuance(evidenceId, signal);
    if (generation.current !== gen) return null;
    setProvenance(state.provenance);
    return state.data;
  }, [client, evidenceId]);

  const fail = useCallback((error: unknown, gen: number, state: EvidenceIssuanceState | null) => {
    if (generation.current !== gen) return;
    if (isSessionExpired(error)) { setPhase({ kind: "session_expired" }); return; }
    if (isFeatureUnavailable(error) || state === null) { setPhase({ kind: "unavailable", message: describeError(error) }); return; }
    const tone = error instanceof ReportVcError && error.code === "attempt_expired" ? "warn" : "error";
    setPhase({ kind: "idle", state, notice: { tone, message: describeError(error) } });
  }, []);

  useEffect(() => {
    if (!client) return;
    const gen = ++generation.current;
    const controller = new AbortController();
    void loadState(gen, controller.signal)
      .then((state) => {
        if (state === null || generation.current !== gen) return;
        if (state.latest && state.latest.status === "issued") {
          setPhase({ kind: "issued", state, issuance: state.latest as IssuanceSettled });
        } else {
          setPhase({ kind: "idle", state });
        }
      })
      .catch((error) => { if (!controller.signal.aborted) fail(error, gen, null); });
    return () => { controller.abort(); generation.current += 1; stopPolling.current(); };
  }, [client, loadState, fail]);

  function watch(gen: number, state: EvidenceIssuanceState, offer: IssuanceOffer) {
    if (!client) return;
    stopPolling.current = startPolling({
      expiresAt: offer.expiresAt,
      initialDelayMs: offer.pollAfterMs,
      request: async (signal) => {
        const status = await client.issuanceStatus(offer.issuanceId, signal);
        if (status.data.status === "offer_ready" || status.data.status === "issuing") {
          if (generation.current === gen) setPhase({ kind: "presenting", state, offer, waiting: status.data.status });
          return { done: false, retryAfterMs: status.data.retryAfterMs };
        }
        setProvenance(status.provenance);
        return { done: true, value: status.data as IssuanceSettled };
      },
      onDone: (issuance) => {
        if (generation.current !== gen) return;
        idempotencyKey.current = null;
        if (issuance.status === "issued") { setPhase({ kind: "issued", state, issuance }); return; }
        const message = issuance.status === "expired"
          ? "발급 QR이 만료되었습니다. 다시 요청하면 새 QR을 만듭니다."
          : issuance.status === "cancelled"
            ? "발급을 취소했습니다."
            : "증명서를 발급하지 못했습니다. 다시 요청할 수 있습니다.";
        setPhase({ kind: "idle", state, notice: { tone: issuance.status === "failed" ? "error" : issuance.status === "expired" ? "warn" : "info", message } });
      },
      onExpired: () => {
        if (generation.current !== gen) return;
        idempotencyKey.current = null;
        setPhase({ kind: "idle", state, notice: { tone: "warn", message: "발급 QR이 만료되었습니다. 다시 요청하면 새 QR을 만듭니다." } });
      },
      onError: (error) => { idempotencyKey.current = null; fail(error, gen, state); },
    });
  }

  async function request() {
    if (!client || busy.current || (phase.kind !== "idle" && phase.kind !== "issued")) return;
    const { state } = phase;
    busy.current = true;
    const gen = ++generation.current;
    stopPolling.current();
    idempotencyKey.current ??= newIdempotencyKey();
    setPhase({ kind: "requesting", state });
    try {
      const created = await client.requestIssuance({ evidenceId, idempotencyKey: idempotencyKey.current });
      if (generation.current !== gen) return;
      setProvenance(created.provenance);
      setPhase({ kind: "presenting", state, offer: created.data, waiting: "offer_ready" });
      watch(gen, state, created.data);
    } catch (error) {
      if (generation.current !== gen) return;
      if (error instanceof ReportVcError && error.code === "issuance_in_progress") {
        // 같은 근거의 발급이 이미 돌고 있다. 새로 만들지 않고 그 상태를 다시 읽는다.
        idempotencyKey.current = null;
        void loadState(gen).then((next) => {
          if (next && generation.current === gen) setPhase({ kind: "idle", state: next, notice: { tone: "info", message: describeError(error) } });
        }).catch((cause) => fail(cause, gen, state));
        return;
      }
      // 네트워크 실패(status 0)만 같은 키로 재전송한다. 서버가 거절한 요청은 새 키다.
      if (isNetworkFailure(error)) {
        setPhase({ kind: "idle", state, notice: { tone: "error", message: describeError(error) } });
        return;
      }
      idempotencyKey.current = null;
      fail(error, gen, state);
    } finally {
      busy.current = false;
    }
  }

  function cancel() {
    if (phase.kind !== "presenting" || !client) return;
    const { issuanceId } = phase.offer;
    generation.current += 1;
    stopPolling.current();
    idempotencyKey.current = null;
    void client.cancelIssuance(issuanceId).catch(() => {});
    setPhase({ kind: "idle", state: phase.state, notice: { tone: "info", message: "발급을 취소했습니다." } });
  }

  const state = phase.kind === "idle" || phase.kind === "requesting" || phase.kind === "presenting" || phase.kind === "issued" ? phase.state : null;

  return (
    <div data-surface="report-vc-issue" className="mt-4 space-y-3 rounded-card border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
            <FileBadge aria-hidden className="size-4 shrink-0 text-primary-500" strokeWidth={2.2} />
            VC로 받기
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            체인에 기록된 이 계산 근거를 {CREDENTIAL_NAME}로 폰의 증명서 지갑에 받습니다. 추정치이며 공식 문서가 아닙니다.
          </p>
        </div>
        {provenance === "mock" ? <ProvenanceChip provenance="mock" /> : null}
      </div>

      {stale && state && (
        <Notice tone="warn" surface="report-vc-issue-stale">
          지금 화면의 계산은 기록된 근거와 다릅니다. 증명서는 체인에 기록된 근거 기준으로 발급됩니다.
        </Notice>
      )}

      {phase.kind === "loading" && <Spinner label="발급 가능 여부를 확인하고 있습니다..." />}
      {phase.kind === "unavailable" && <Notice tone="info" surface="report-vc-issue-unavailable">{phase.message}</Notice>}
      {phase.kind === "session_expired" && <SessionExpiredNotice surface="report-vc-issue-session" />}

      {(phase.kind === "idle" || phase.kind === "issued") && state && (
        <div className="space-y-3">
          {phase.kind === "idle" && phase.notice && <Notice tone={phase.notice.tone} surface="report-vc-issue-notice">{phase.notice.message}</Notice>}

          {phase.kind === "issued" && (
            <div role="status" data-surface="report-vc-issued" className="rounded-card border border-emerald-200 bg-emerald-50 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                <CircleCheck aria-hidden className="size-5 shrink-0 text-emerald-600" />
                증명서가 발급되었습니다
              </p>
              <p className="mt-1 text-xs leading-5 text-emerald-900">{issuedLine(phase.issuance)}</p>
              {provenance === "mock" && <p className="mt-1 text-xs leading-5 text-emerald-900">mock 데이터입니다. 실제 발급이 아닙니다.</p>}
            </div>
          )}

          {phase.kind === "idle" && state.latest && state.latest.status !== "issued" && state.latest.status !== "offer_ready" && state.latest.status !== "issuing" && (
            <p className="text-xs text-zinc-500">최근 요청 · {issuedLine(state.latest)} · {state.latest.status === "expired" ? "만료" : state.latest.status === "cancelled" ? "취소" : "실패"}</p>
          )}

          {state.eligibility === "ready" ? (
            <button type="button" className={phase.kind === "issued" ? SECONDARY_BUTTON : PRIMARY_BUTTON} onClick={() => void request()}>
              {phase.kind === "issued" ? "새 버전으로 다시 받기" : "증명서 발급 요청"}
            </button>
          ) : (
            <Notice tone={ELIGIBILITY_TEXT[state.eligibility].tone} surface={`report-vc-issue-${state.eligibility}`}>
              <span className="block font-semibold">{ELIGIBILITY_TEXT[state.eligibility].title}</span>
              <span className="block">{ELIGIBILITY_TEXT[state.eligibility].body}</span>
              {state.eligibility === "wallet_unlinked" && (
                <Link href="/settings" className="mt-1 inline-block font-semibold text-primary-600 underline">설정에서 지갑 연결</Link>
              )}
              {(state.eligibility === "anchor_failed" || state.eligibility === "anchor_missing") && (
                <Link href="/export" className="mt-1 inline-block font-semibold text-primary-600 underline">내려받기로 이동</Link>
              )}
            </Notice>
          )}
        </div>
      )}

      {phase.kind === "requesting" && <Spinner label="발급을 요청하고 있습니다..." />}

      {phase.kind === "presenting" && (
        <div className="space-y-2">
          {phase.waiting === "issuing" && <Notice tone="info">지갑이 제출했습니다. 발급 서버가 증명서를 만들고 있습니다.</Notice>}
          <QrPanel
            text={phase.offer.qr.text}
            title="증명서 발급 QR 코드"
            hint="폰의 증명서 지갑으로 이 QR을 스캔하면 증명서를 받을 수 있습니다. 지갑에서 받기를 승인해야 발급이 끝납니다."
            expiresAt={phase.offer.expiresAt}
            onCancel={cancel}
            cancelLabel="발급 취소"
          />
        </div>
      )}
    </div>
  );
}
