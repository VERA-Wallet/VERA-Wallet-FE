"use client";

import { ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { FileCheck } from "@/components/report-vc/file-check";
import { Notice, PRIMARY_BUTTON, QrPanel, SECONDARY_BUTTON, Spinner } from "@/components/report-vc/primitives";
import { VerificationResultView } from "@/components/report-vc/verification-result";
import { Card } from "@/components/ui/card";
import type { Provenance } from "@/lib/http/envelope";
import type { ReportVcClient } from "@/lib/report-vc/client";
import { useReportVcClient } from "@/lib/report-vc/composition";
import { CREDENTIAL_NAME, describeError, isFeatureUnavailable, isNetworkFailure } from "@/lib/report-vc/messages";
import { startPolling } from "@/lib/report-vc/poll";
import { ReportVcError, type Disclosure, type ReportVcCapabilities, type VerificationAttempt, type VerificationResult } from "@/lib/report-vc/types";

/**
 * 제3자 검증 화면(`/verify/report`). 서비스 로그인 없이 연다.
 *
 * 1. 공개 범위 선택(기본 검증 / 금액 포함 검증. 기본은 금액 없음)
 * 2. 검증 QR 생성
 * 3. 리포트 보유자가 폰의 증명서 지갑으로 QR을 읽고 VP를 제출
 * 4. 서버 검증 결과 표시, 그 뒤 받은 파일 대조
 *
 * 선택 공개는 서버 정책이 정한다. 화면은 `capabilities.disclosures`에 있는 범위만 고르게 하고,
 * 결과의 `claims`에 실린 것만 보인다. 클라이언트에서 금액을 감추는 것으로 선택 공개를 대신하지 않는다.
 */
type Phase =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "choose"; notice?: { tone: "info" | "warn" | "error"; message: string } }
  | { kind: "creating" }
  | { kind: "presenting"; attempt: VerificationAttempt }
  | { kind: "result"; attempt: VerificationAttempt; result: VerificationResult };

const DISCLOSURE_LABEL: Record<Disclosure, { title: string; body: string }> = {
  basic: { title: "기본 검증", body: "리포트 식별 정보와 무결성(발급자, 폐기 상태, 버전, 체인 기록)만 확인합니다. 금액은 공개되지 않습니다." },
  with_amounts: { title: "금액 포함 검증", body: "기본 검증에 더해 합계 금액(예상 부담 추정, 과세 대상, 수령 소득)을 KRW로 공개합니다." },
};

export function ReportVerifyView({ client: override }: { client?: ReportVcClient }) {
  const client = useReportVcClient(override);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [capabilities, setCapabilities] = useState<ReportVcCapabilities | null>(null);
  const [disclosure, setDisclosure] = useState<Disclosure>("basic");
  const [provenance, setProvenance] = useState<Provenance>("live");
  const generation = useRef(0);
  const stopPolling = useRef<() => void>(() => {});
  const busy = useRef(false);

  const fail = useCallback((error: unknown, gen: number) => {
    if (generation.current !== gen) return;
    if (isFeatureUnavailable(error)) { setPhase({ kind: "unavailable", message: describeError(error) }); return; }
    if (error instanceof ReportVcError && error.code === "attempt_cancelled") { setPhase({ kind: "choose", notice: { tone: "info", message: "검증을 취소했습니다." } }); return; }
    const tone = error instanceof ReportVcError && error.code === "attempt_expired" ? "warn" : "error";
    setPhase({ kind: "choose", notice: { tone, message: describeError(error) } });
  }, []);

  useEffect(() => {
    if (!client) return;
    const gen = ++generation.current;
    const controller = new AbortController();
    void client.capabilities(controller.signal)
      .then((loaded) => {
        if (generation.current !== gen) return;
        setProvenance(loaded.provenance);
        if (!loaded.data.enabled || !loaded.data.verification) {
          setPhase({ kind: "unavailable", message: "리포트 증명서 검증 기능이 아직 준비되지 않았습니다." });
          return;
        }
        setCapabilities(loaded.data);
        setPhase({ kind: "choose" });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (isNetworkFailure(error) && generation.current === gen) { setPhase({ kind: "unavailable", message: describeError(error) }); return; }
        fail(error, gen);
      });
    return () => { controller.abort(); generation.current += 1; stopPolling.current(); };
  }, [client, fail]);

  async function create() {
    if (!client || busy.current) return;
    busy.current = true;
    const gen = ++generation.current;
    stopPolling.current();
    setPhase({ kind: "creating" });
    try {
      const created = await client.createVerification({ disclosure });
      if (generation.current !== gen) return;
      setProvenance(created.provenance);
      const attempt = created.data;
      setPhase({ kind: "presenting", attempt });
      stopPolling.current = startPolling({
        expiresAt: attempt.expiresAt,
        initialDelayMs: attempt.pollAfterMs,
        request: async (signal) => {
          const status = await client.verificationStatus(attempt.verificationId, signal);
          if (status.data.status === "pending") return { done: false, retryAfterMs: status.data.retryAfterMs };
          setProvenance(status.provenance);
          return { done: true, value: status.data };
        },
        onDone: (result) => { if (generation.current === gen) setPhase({ kind: "result", attempt, result }); },
        onExpired: () => { if (generation.current === gen) setPhase({ kind: "choose", notice: { tone: "warn", message: "검증 QR이 만료되었습니다. 새 QR을 만들어 다시 시도하세요." } }); },
        onError: (error) => fail(error, gen),
      });
    } catch (error) {
      fail(error, gen);
    } finally {
      busy.current = false;
    }
  }

  function cancel() {
    if (phase.kind !== "presenting" || !client) return;
    const { verificationId } = phase.attempt;
    generation.current += 1;
    stopPolling.current();
    void client.cancelVerification(verificationId).catch(() => {});
    setPhase({ kind: "choose", notice: { tone: "info", message: "검증을 취소했습니다." } });
  }

  function reset() {
    generation.current += 1;
    stopPolling.current();
    setPhase({ kind: "choose" });
  }

  const disclosures = capabilities?.disclosures ?? [];

  return (
    <main data-surface="report-vc-verify" className="min-h-dvh px-5 py-8">
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-zinc-900">
        <ShieldCheck aria-hidden className="size-6 shrink-0 text-primary-500" strokeWidth={2} />
        리포트 증명서 검증
      </h1>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        리포트 보유자가 폰의 증명서 지갑으로 제출한 {CREDENTIAL_NAME}를 검증합니다. 이 증명서는 추정치이며 공식 문서가 아닙니다. 이 페이지는 로그인 없이 쓸 수 있고, 제출자의 이름이나 신분증 정보는 표시하지 않습니다.
      </p>

      <Card className="mt-6 space-y-4">
        {phase.kind === "loading" && <Spinner label="검증 기능을 확인하고 있습니다..." />}
        {phase.kind === "unavailable" && <Notice tone="info" surface="report-vc-verify-unavailable">{phase.message}</Notice>}

        {phase.kind === "choose" && capabilities && (
          <div className="space-y-4">
            {phase.notice && <Notice tone={phase.notice.tone} surface="report-vc-verify-notice">{phase.notice.message}</Notice>}
            <fieldset>
              <legend className="text-sm font-semibold text-zinc-900">공개 범위</legend>
              <p className="mt-1 text-xs text-zinc-500">리포트 보유자는 폰에서 이 범위에 동의한 뒤 제출합니다. 지원 범위는 검증 서버가 정합니다.</p>
              <div className="mt-3 space-y-2">
                {(["basic", "with_amounts"] as const).map((option) => {
                  const supported = disclosures.includes(option);
                  const checked = disclosure === option;
                  return (
                    <label
                      key={option}
                      className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-card border p-3 ${checked ? "border-primary-500 bg-primary-50" : "border-zinc-200 bg-white"} ${supported ? "" : "cursor-not-allowed opacity-60"}`}
                    >
                      <input
                        type="radio"
                        name="disclosure"
                        value={option}
                        className="mt-1 size-4 shrink-0 accent-primary-500"
                        checked={checked}
                        disabled={!supported}
                        onChange={() => setDisclosure(option)}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-zinc-900">
                          {DISCLOSURE_LABEL[option].title}
                          {!supported && <span className="ml-1 text-xs font-normal text-zinc-500">(미지원)</span>}
                        </span>
                        <span className="block text-xs leading-5 text-zinc-500">{DISCLOSURE_LABEL[option].body}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <button type="button" className={PRIMARY_BUTTON} disabled={!disclosures.includes(disclosure)} onClick={() => void create()}>
              검증 QR 만들기
            </button>
          </div>
        )}

        {phase.kind === "creating" && <Spinner label="검증 QR을 준비하고 있습니다..." />}

        {phase.kind === "presenting" && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-zinc-900">{DISCLOSURE_LABEL[phase.attempt.disclosure].title}</p>
            <QrPanel
              text={phase.attempt.qr.text}
              title="리포트 증명서 검증 QR 코드"
              hint="리포트 보유자가 폰의 증명서 지갑으로 이 QR을 스캔하고 제출하면 결과가 여기에 표시됩니다."
              expiresAt={phase.attempt.expiresAt}
              onCancel={cancel}
              cancelLabel="검증 취소"
            />
          </div>
        )}

        {phase.kind === "result" && (
          <div className="space-y-5">
            <VerificationResultView result={phase.result} provenance={provenance} />
            {phase.result.status === "verified" && client && capabilities && (
              <div className="border-t border-zinc-100 pt-4">
                <FileCheck client={client} verificationId={phase.attempt.verificationId} capabilities={capabilities} />
              </div>
            )}
            <button type="button" className={SECONDARY_BUTTON} onClick={reset}>새 검증 시작</button>
          </div>
        )}
      </Card>
    </main>
  );
}
