"use client";

import Link from "next/link";

import { CircleCheck, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CopyValue, Notice, PRIMARY_BUTTON, QUIET_BUTTON, QrPanel, SECONDARY_BUTTON, SessionExpiredNotice, Spinner, shortDid } from "@/components/report-vc/primitives";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import type { Provenance } from "@/lib/http/envelope";
import type { ReportVcClient } from "@/lib/report-vc/client";
import { useReportVcClient } from "@/lib/report-vc/composition";
import { describeError, isFeatureUnavailable, isNetworkFailure, isSessionExpired } from "@/lib/report-vc/messages";
import { startPolling } from "@/lib/report-vc/poll";
import { ReportVcError, type LinkAttempt, type LinkedWallet } from "@/lib/report-vc/types";

/**
 * 증명서 지갑(Open DID) 연결 카드. 설정 화면의 한 섹션이다.
 *
 * 암호화폐 지갑(SIWE, `/connect-wallet`)과 다른 지갑이다. 이 지갑은 거래를 읽는 데 쓰지 않고,
 * 추정 세금 리포트 증명서(VC)를 받아 두는 곳이다. 연결은 폰의 Open DID 지갑이 QR을 읽고
 * PIN/BIO로 DID 소유 증명을 제출해야 끝난다. QR을 그린 것만으로는 연결이 아니다.
 *
 * 상태 전이는 로그인의 Open DID 흐름(`components/did/did-login-flow.tsx`)과 같은 규칙을 따른다:
 * 시도마다 세대 번호를 올려 늦은 응답이 새 화면을 덮지 않고, 만료·취소·이탈 때 폴링을 멈춘다.
 * 기존 로그인 API(`/api/auth/did/*`)는 부르지 않는다. 이 카드는 로그인과 별개의 기능이다.
 */
type Phase =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "session_expired" }
  | { kind: "reauthentication_required"; message: string }
  | { kind: "unlinked"; notice?: { tone: "info" | "warn" | "error"; message: string } }
  | { kind: "creating" }
  | { kind: "presenting"; attempt: LinkAttempt }
  | { kind: "linked"; wallet: LinkedWallet; confirmingUnlink: boolean; unlinking: boolean; error: string | null };

export function WalletLinkCard({ client: override }: { client?: ReportVcClient }) {
  const client = useReportVcClient(override);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [provenance, setProvenance] = useState<Provenance>("live");
  const generation = useRef(0);
  const stopPolling = useRef<() => void>(() => {});
  const busy = useRef(false);

  const fail = useCallback((error: unknown, gen: number) => {
    if (generation.current !== gen) return;
    if (error instanceof ReportVcError && error.code === "cx_reauthentication_required") { setPhase({ kind: "reauthentication_required", message: describeError(error) }); return; }
    if (isSessionExpired(error)) { setPhase({ kind: "session_expired" }); return; }
    if (isFeatureUnavailable(error)) { setPhase({ kind: "unavailable", message: describeError(error) }); return; }
    if (error instanceof ReportVcError && error.code === "attempt_cancelled") { setPhase({ kind: "unlinked", notice: { tone: "info", message: "연결을 취소했습니다." } }); return; }
    const tone = error instanceof ReportVcError && error.code === "attempt_expired" ? "warn" : "error";
    setPhase({ kind: "unlinked", notice: { tone, message: describeError(error) } });
  }, []);

  // 처음 열 때 기능 지원 여부와 연결 상태를 함께 묻는다. 둘 중 하나라도 "준비 중"이면 그 사실만 보인다.
  useEffect(() => {
    if (!client) return;
    const gen = ++generation.current;
    const controller = new AbortController();
    void (async () => {
      try {
        const capabilities = await client.capabilities(controller.signal);
        if (generation.current !== gen) return;
        if (!capabilities.data.enabled || !capabilities.data.walletLink) {
          setPhase({ kind: "unavailable", message: "증명서 지갑 연결 기능이 아직 준비되지 않았습니다." });
          return;
        }
        const wallet = await client.walletState(controller.signal);
        if (generation.current !== gen) return;
        setProvenance(wallet.provenance);
        setPhase(wallet.data.status === "linked"
          ? { kind: "linked", wallet: wallet.data, confirmingUnlink: false, unlinking: false, error: null }
          : { kind: "unlinked" });
      } catch (error) {
        if (controller.signal.aborted) return;
        // 처음 불러올 때의 연결 실패는 "서버 연결 실패"로 접는다. 진행 중의 실패는 fail()이 미연결 상태에서 다시 시도하게 둔다.
        if (isNetworkFailure(error) && generation.current === gen) { setPhase({ kind: "unavailable", message: describeError(error) }); return; }
        fail(error, gen);
      }
    })();
    return () => { controller.abort(); generation.current += 1; stopPolling.current(); };
  }, [client, fail]);

  async function start() {
    if (!client || busy.current) return;
    busy.current = true;
    const gen = ++generation.current;
    stopPolling.current();
    setPhase({ kind: "creating" });
    try {
      const created = await client.createLinkAttempt();
      if (generation.current !== gen) return;
      setProvenance(created.provenance);
      setPhase({ kind: "presenting", attempt: created.data });
      stopPolling.current = startPolling({
        diagnosticName: "vc.link_wait",
        expiresAt: created.data.expiresAt,
        initialDelayMs: created.data.pollAfterMs,
        request: async (signal) => {
          const status = await client.linkAttemptStatus(created.data.attemptId, signal);
          if (status.data.status === "pending") return { done: false, retryAfterMs: status.data.retryAfterMs };
          setProvenance(status.provenance);
          return { done: true, value: status.data };
        },
        onDone: (wallet) => {
          if (generation.current !== gen) return;
          setPhase({ kind: "linked", wallet, confirmingUnlink: false, unlinking: false, error: null });
        },
        onExpired: () => {
          if (generation.current !== gen) return;
          setPhase({ kind: "unlinked", notice: { tone: "warn", message: "QR이 만료되었습니다. 새 QR로 다시 시도하세요." } });
        },
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
    const { attemptId } = phase.attempt;
    generation.current += 1;
    stopPolling.current();
    // 서버에도 취소를 알린다. 실패해도 화면은 이미 물러났으므로 조용히 둔다(시도는 만료로 닫힌다).
    void client.cancelLinkAttempt(attemptId).catch(() => {});
    setPhase({ kind: "unlinked", notice: { tone: "info", message: "연결을 취소했습니다." } });
  }

  async function unlink() {
    if (phase.kind !== "linked" || !client || phase.unlinking) return;
    const gen = ++generation.current;
    setPhase({ ...phase, unlinking: true, error: null });
    try {
      await client.unlinkWallet();
      if (generation.current !== gen) return;
      setPhase({ kind: "unlinked", notice: { tone: "info", message: "증명서 지갑 연결을 해제했습니다." } });
    } catch (error) {
      if (generation.current !== gen) return;
      if (isSessionExpired(error)) { setPhase({ kind: "session_expired" }); return; }
      setPhase({ ...phase, unlinking: false, confirmingUnlink: false, error: describeError(error) });
    }
  }

  return (
    <div data-surface="report-vc-wallet" className="space-y-3 rounded-card border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
            <ShieldCheck aria-hidden className="size-4 shrink-0 text-primary-500" strokeWidth={2.2} />
            증명서 지갑
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            추정 세금 리포트 증명서(VC)를 받아 두는 Open DID 지갑입니다. 거래를 읽는 암호화폐 지갑과는 다른 지갑이며, 연결해도 계정이나 로그인은 바뀌지 않습니다.
          </p>
        </div>
        {provenance === "mock" ? <ProvenanceChip provenance="mock" /> : null}
      </div>

      <Link href="/did-wallet/install" className="inline-block text-sm text-primary-600 underline underline-offset-4">DID CA 앱 설치·처음 사용하는 방법</Link>

      {phase.kind === "loading" && (client ? <Spinner label="연결 상태를 확인하고 있습니다..." /> : <Spinner label="미리보기 데이터를 준비하고 있습니다..." />)}

      {phase.kind === "unavailable" && <Notice tone="info" surface="report-vc-wallet-unavailable">{phase.message}</Notice>}

      {phase.kind === "reauthentication_required" && (
        <Notice tone="info" surface="report-vc-wallet-reauthentication">
          <p>{phase.message}</p>
          <Link href="/settings/verify-identity" className="mt-2 inline-block font-semibold underline underline-offset-4">본인확인 다시 하기</Link>
          <p className="mt-1 text-xs">로그아웃할 필요 없이 인증 후 이 화면으로 돌아옵니다.</p>
        </Notice>
      )}

      {phase.kind === "session_expired" && <SessionExpiredNotice surface="report-vc-wallet-session" />}

      {phase.kind === "unlinked" && (
        <div className="space-y-3">
          {phase.notice && <Notice tone={phase.notice.tone} surface="report-vc-wallet-notice">{phase.notice.message}</Notice>}
          <p className="text-sm text-zinc-600">아직 연결된 증명서 지갑이 없습니다.</p>
          <button type="button" className={PRIMARY_BUTTON} onClick={() => void start()}>증명서 지갑 연결</button>
        </div>
      )}

      {phase.kind === "creating" && <Spinner label="연결 QR을 준비하고 있습니다..." />}

      {phase.kind === "presenting" && (
        <QrPanel
          text={phase.attempt.qr.text}
          title="증명서 지갑 연결 QR 코드"
          hint="폰의 Open DID 지갑으로 이 QR을 스캔하고 PIN 또는 생체 인증으로 제출하세요."
          expiresAt={phase.attempt.expiresAt}
          onCancel={cancel}
        />
      )}

      {phase.kind === "linked" && (
        <div className="space-y-3">
          <div role="status" className="flex items-center gap-2 text-sm font-medium text-zinc-900">
            <CircleCheck aria-hidden className="size-5 shrink-0 text-primary-500" />
            증명서 지갑이 연결되어 있습니다
          </div>
          <div className="rounded-card border border-zinc-200 bg-white p-3">
            <CopyValue label="DID" value={phase.wallet.did} display={shortDid} />
            {phase.wallet.walletName && (
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="shrink-0 text-sm text-zinc-500">지갑</span>
                <span className="truncate text-sm text-zinc-800">{phase.wallet.walletName}</span>
              </div>
            )}
          </div>
          {phase.error && <Notice tone="error">{phase.error}</Notice>}
          {phase.confirmingUnlink ? (
            <div className="space-y-2 rounded-card border border-zinc-200 bg-white p-3" role="group" aria-label="연결 해제 확인">
              <p className="text-sm leading-6 text-zinc-700">
                이 계정에서 증명서 지갑 연결을 해제할까요? 해제한 뒤에는 새 증명서를 받으려면 다시 연결해야 합니다. 이미 받은 증명서가 어떻게 되는지는 발급 정책에 따르며, 이 화면에서 정하지 않습니다.
              </p>
              <button type="button" className={SECONDARY_BUTTON} disabled={phase.unlinking} onClick={() => void unlink()}>
                {phase.unlinking ? "해제하는 중..." : "연결 해제"}
              </button>
              <button type="button" className={QUIET_BUTTON} disabled={phase.unlinking} onClick={() => setPhase({ ...phase, confirmingUnlink: false, error: null })}>
                유지하기
              </button>
            </div>
          ) : (
            <button type="button" className={QUIET_BUTTON} onClick={() => setPhase({ ...phase, confirmingUnlink: true, error: null })}>
              연결 해제...
            </button>
          )}
        </div>
      )}
    </div>
  );
}
