"use client";

import { measure } from "@/lib/diagnostics/performance";
import { useQueryClient } from "@tanstack/react-query";
import { refreshRegisteredWallets } from "@/lib/queries/holdings";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SiweMessage } from "siwe";
import { AlertCircle, Building2, Check, ChevronLeft, ChevronRight, ClipboardPaste, Info, KeyRound, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ProvenanceChip } from "@/components/ui/provenance-chip";
import type { Provenance } from "@/lib/http/envelope";
import { ChainIcon } from "@/components/ui/chain-icon";
import { chainLabel } from "@/lib/format";
import { EXCHANGES } from "@/lib/exchange/mock-links";
import { EVM_CHAIN_IDS } from "@/lib/wallet/import-progress";
import type { WalletAccount, WalletPort } from "@/lib/ports/wallet-port";
import { wagmiWalletPort } from "@/lib/wallet/wagmi-wallet-port";
import { assessWalletAddress, type WalletAddressAssessment } from "@/lib/wallet/address";
import { authClient as compositionAuthClient } from "@/lib/composition-root.client";
import { AuthClientError, type AuthClient } from "@/lib/ports/auth-client";

// SIWE 오류는 status가 아니라 error code로 분기한다.
// BE와 FE mock의 status는 이제 정렬됐다(재사용 409, 불일치 400). code 분기는 원인 구분을 위해 유지한다. 모든 400·409를 한 문구로 뭉개면
// challenge_not_found나 요청 형식 오류까지 "인증 요청 불일치"가 되어 원인이 사라진다.
// AuthClientError.code와 decodeResponse의 error 스키마 모두 code를 필수 문자열로 요구하므로 code는 항상 존재한다.
const SIWE_CHALLENGE_MISMATCH_CODES = new Set(["already-consumed", "challenge_mismatch"]);

function errorMessage(cause: unknown) {
  if (cause instanceof AuthClientError) {
    if (SIWE_CHALLENGE_MISMATCH_CODES.has(cause.code)) return "인증 요청 불일치";
    if (cause.code === "challenge_not_found") return "인증 요청을 찾을 수 없습니다. 다시 시도해 주세요.";
    if (cause.code === "challenge_expired") return "만료됨. 다시 시도";
    if (cause.code === "unauthorized") return "로그인 세션이 만료되었거나 유효하지 않습니다. 다시 로그인해 주세요.";
    if (cause.status === 401) return "서명을 확인할 수 없습니다.";
  }
  return cause instanceof Error ? cause.message : "인증 중 오류가 발생했습니다.";
}

function walletConnectionError(cause: unknown): string {
  let current = cause;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const error = current as { code?: number; cause?: unknown };
    if (error.code === 4001) return "지갑 연결을 취소했습니다. 다시 연결할 수 있습니다.";
    if (error.code === -32002) return "지갑에 진행 중인 요청이 있습니다. MetaMask 앱 또는 지갑 확장 프로그램에서 확인해 주세요.";
    current = error.cause;
  }
  return "지갑 연결을 완료하지 못했습니다. MetaMask 앱 또는 브라우저 지갑을 확인한 뒤 다시 시도해 주세요.";
}

function isSameAddress(left: string, right: string | null) {
  return right !== null && left.toLowerCase() === right.toLowerCase();
}

/** 화면 순서. 확인은 별도 화면이 아니라 `address` 위에 뜨는 바텀시트다. */
type Step = "method" | "address" | "siwe";
type SigningPhase = "idle" | "preparing" | "signing" | "verifying" | "redirecting";
const SIGNING_LABELS: Record<SigningPhase, string> = { idle: "서명하고 추가", preparing: "서명 요청 준비 중…", signing: "지갑에서 서명 대기 중…", verifying: "서명 확인 중…", redirecting: "거래 조회 준비 중…" };

export type ConnectWalletMode = "onboarding" | "add";

const STEP_TOTAL = 3;

const CTA_CLASS =
  "flex h-14 w-full items-center justify-center rounded-[14px] bg-primary-500 text-base font-bold text-white disabled:bg-primary-200";

/**
 * 지갑을 등록한다. 토스식 "한 화면 한 질문"으로 세 단계를 밟는다.
 *
 * 1. **방법 선택** — 주소로 추가(추천) · 브라우저 지갑으로 연결 · 거래소(준비 중).
 * 2. **주소 입력** — 붙여넣는 즉시 형식·체크섬·중복을 판정해 입력창 아래에 말한다. 조회 체인은 고르게 하지 않는다:
 *    EVM 주소는 체인이 달라도 같고 서버가 지원 체인 전체를 스캔하므로, 읽기 전용 칩으로 보여만 준다.
 * 3. **확인 시트** — 전체 주소·조회 체인·미검증 안내를 한 번 더 보이고 등록한다.
 *
 * 브라우저 지갑 경로(SIWE)는 2단계의 대안이다. 서명은 "지금 이 브라우저에 있는 키"만 커버하는데 세금은 과거 전체를 봐야 하므로
 * 주소 입력이 기본이고, 소유 증명은 등록 뒤 지갑 화면에서 뒤늦게 할 수 있게 둔다.
 *
 * 첫 등록이든 추가 등록이든 절차는 같다 — 두 경로 모두 DID 세션을 유지한 채 지갑 바인딩만 만든다.
 * redirectTo가 갈리는 이유는 시작 지점이 다르기 때문이다. 온보딩은 대시보드에서 불러오기를 보여줘야 하고,
 * 지갑 탭에서 추가하러 온 사용자는 왔던 지갑 탭으로 돌아가야 한다.
 */
export function ConnectWalletFlow({
  walletPort = wagmiWalletPort,
  authClient = compositionAuthClient,
  redirectTo = "/dashboard?importing=1",
  boundAddress = null,
  mode = "onboarding",
  exitTo = "/dashboard",
  countryCode = null,
  initialStep = "method",
  provenance = "mock",
}: {
  walletPort?: WalletPort;
  authClient?: AuthClient;
  redirectTo?: string;
  /** 이미 등록된 지갑 주소. 같은 주소를 다시 등록하면 서버가 upsert라 아무 일도 안 일어나므로 미리 막는다. */
  boundAddress?: string | null;
  mode?: ConnectWalletMode;
  /** 닫기(X)가 돌아갈 곳. 온보딩은 대시보드(빈 상태), 추가 등록은 지갑 탭. */
  exitTo?: string;
  countryCode?: string | null;
  /** 진입 단계. 지갑 탭의 시트가 방법을 미리 골랐으면 그 단계로 바로 연다. */
  initialStep?: Step;
  /** 서버 페이지가 BE 모드를 물어 계산한 데이터 출처. 이 화면의 응답에는 출처가 실려 오지 않는다. */
  provenance?: Provenance;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(initialStep);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [account, setAccount] = useState<WalletAccount | null>(() => walletPort.getAccount());
  const [addressInput, setAddressInput] = useState("");
  const [addressTouched, setAddressTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [signingPhase, setSigningPhase] = useState<SigningPhase>("idle");
  const signingRun = useRef<object | null>(null);
  const connectingRun = useRef<object | null>(null);
  useEffect(() => () => { signingRun.current = null; connectingRun.current = null; }, []);
  function cancelSigningView() {
    signingRun.current = null;
    connectingRun.current = null;
    setIsConnecting(false);
    setSigningPhase("idle");
  }
  const [isRegistering, setIsRegistering] = useState(false);

  useEffect(() => walletPort.subscribeConnection(setAccount), [walletPort]);

  const assessment = useMemo(() => assessWalletAddress(addressInput, boundAddress), [addressInput, boundAddress]);
  const adding = mode === "add";

  function go(next: Step) {
    cancelSigningView();
    // 오류는 화면에 딸린 것이다. 남겨 두면 주소 형식 오류가 서명 화면에 떠 있게 된다.
    setError(null);
    setConfirmOpen(false);
    setStep(next);
  }

  async function pasteFromClipboard() {
    setError(null);
    try {
      const text = await navigator.clipboard.readText();
      setAddressInput(text.trim());
      setAddressTouched(true);
    } catch {
      setError("브라우저에서 클립보드 접근을 허용하지 않았습니다. 입력창에 직접 붙여넣어 주세요.");
    }
  }

  async function registerAddress() {
    if (assessment.kind !== "valid") return;
    setError(null);
    setIsRegistering(true);
    try {
      await authClient.registerWatchWallet({ address: assessment.address });
      await refreshRegisteredWallets(queryClient);
      router.push(redirectTo);
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setIsRegistering(false);
    }
  }

  async function connectWallet(kind: "browser" | "metamask" = "browser") {
    if (connectingRun.current) return;
    const run = {};
    connectingRun.current = run;
    setError(null);
    setIsConnecting(true);
    try {
      const connected = await measure("wallet.connect_approval", () => walletPort.connect(kind));
      if (connectingRun.current === run) setAccount(connected);
    } catch (cause) {
      if (connectingRun.current === run) setError(walletConnectionError(cause));
    } finally {
      if (connectingRun.current === run) {
        connectingRun.current = null;
        setIsConnecting(false);
      }
    }
  }

  async function signIn() {
    if (!account || signingRun.current) return;
    setError(null);
    const signingAccount = walletPort.getAccount();
    if (!signingAccount || !isSameAddress(signingAccount.address, account.address) || signingAccount.chainId !== account.chainId) {
      setAccount(signingAccount);
      setError("연결된 지갑 계정 또는 네트워크가 변경되었습니다. 확인 후 다시 서명해 주세요.");
      return;
    }
    // 확장 프로그램은 이미 승인된 오리진에서 활성 계정을 그대로 돌려준다. 그대로 서명하면 같은 지갑을
    // 다시 등록하는 셈이고 서버는 upsert라 조용히 아무 일도 일어나지 않는다 — 서명을 요구하기 전에 끊는다.
    if (isSameAddress(account.address, boundAddress)) {
      setError("이미 등록된 지갑입니다. 지갑 확장 프로그램에서 다른 계정으로 바꾼 뒤 다시 시도해 주세요.");
      return;
    }
    const run = {};
    signingRun.current = run;
    setSigningPhase("preparing");
    try {
      const nonce = await authClient.requestNonce({ chainId: account.chainId });
      if (signingRun.current !== run) return;
      const message = new SiweMessage({
        address: account.address as `0x${string}`,
        version: "1",
        chainId: nonce.chainId,
        domain: nonce.domain,
        uri: nonce.uri,
        nonce: nonce.nonce,
        issuedAt: nonce.issuedAt,
        expirationTime: new Date(nonce.expiresAtMs).toISOString(),
      }).prepareMessage();
      setSigningPhase("signing");
      const signature = await measure("wallet.sign_approval", () => walletPort.signMessage(message, signingAccount));
      if (signingRun.current !== run) return;
      setSigningPhase("verifying");
      await authClient.verify({ message, signature });
      if (signingRun.current !== run) return;
      await refreshRegisteredWallets(queryClient);
      if (signingRun.current !== run) return;
      setSigningPhase("redirecting");
      // 서명이 끝나도 인덱서 동기화는 남아 있다. 대시보드로 그냥 보내면 사용자는 빈 화면을 먼저 보고
      // "연결이 안 됐나"로 읽는다. 온보딩 기본값은 `importing`을 달고 들어가 불러오기 모달을 띄운다.
      router.push(redirectTo);
      router.refresh();
    } catch (cause) {
      if (signingRun.current !== run) return;
      signingRun.current = null;
      setSigningPhase("idle");
      setError(errorMessage(cause));
    }
  }

  const stepIndex = step === "method" ? 1 : confirmOpen ? 3 : 2;
  const flowLabel = adding ? "지갑 추가" : "지갑 연결";

  return (
    <main data-surface="wallet-connect" className="flex min-h-dvh flex-col pb-7">
      {/* 상단 바: 첫 화면에는 뒤로가기가 없다(온보딩은 앞 화면이 없고, 추가 등록은 닫기가 같은 일을 한다). */}
      <div className="flex h-14 items-center justify-between pl-2 pr-3">
        {step === "method" ? (
          <span className="w-10" />
        ) : (
          <button
            type="button"
            aria-label="뒤로"
            onClick={() => go("method")}
            className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 active:bg-zinc-200"
          >
            <ChevronLeft aria-hidden="true" className="size-6" />
          </button>
        )}
        <Link
          href={exitTo}
          aria-label="닫기"
          onClick={cancelSigningView}
          className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 active:bg-zinc-200"
        >
          <X aria-hidden="true" className="size-6" />
        </Link>
      </div>

      <ol aria-label={`${flowLabel} 진행 단계`} className="flex gap-1.5 px-5">
        {Array.from({ length: STEP_TOTAL }, (_, index) => (
          <li
            key={index}
            aria-current={index + 1 === stepIndex ? "step" : undefined}
            className={`h-[3px] flex-1 rounded-full ${index < stepIndex ? "bg-primary-500" : "bg-zinc-200"}`}
          />
        ))}
      </ol>

      {step === "method" ? (
        <MethodStep
          adding={adding}
          flowLabel={flowLabel}
          countryCode={countryCode}
          error={error}
          provenance={provenance}
          onAddress={() => go("address")}
          onSiwe={() => go("siwe")}
        />
      ) : step === "address" ? (
        <AddressStep
          flowLabel={flowLabel}
          value={addressInput}
          touched={addressTouched}
          assessment={assessment}
          error={error}
          onChange={(value) => {
            setError(null);
            setAddressInput(value);
          }}
          onBlur={() => setAddressTouched(true)}
          onClear={() => {
            setAddressInput("");
            setAddressTouched(false);
          }}
          onPaste={pasteFromClipboard}
          onNext={() => {
            setError(null);
            setConfirmOpen(true);
          }}
        />
      ) : (
        <SiweStep
          flowLabel={flowLabel}
          account={account}
          boundAddress={boundAddress}
          error={error}
          isConnecting={isConnecting}
          signingPhase={signingPhase}
          onConnect={() => void connectWallet("browser")}
          onConnectMetaMask={() => void connectWallet("metamask")}
          onSign={signIn}
          onFallback={() => go("address")}
        />
      )}

      <BottomSheet open={confirmOpen} onClose={() => setConfirmOpen(false)} title="지갑 추가 확인">
        {assessment.kind === "valid" ? (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-zinc-900">지갑 추가 확인</h2>
              <p className="mt-1.5 text-sm leading-[21px] text-zinc-500">지갑을 추가하면 거래 조회가 시작됩니다.</p>
            </div>
            <dl className="rounded-2xl bg-zinc-50">
              <div className="border-b border-zinc-100 px-4 py-3.5">
                <dt className="text-xs font-semibold text-zinc-500">주소</dt>
                <dd className="mt-1.5 break-all font-mono text-[13px] leading-[19px] text-zinc-900">{assessment.address}</dd>
              </div>
              <div className="flex items-center justify-between px-4 py-3.5">
                <dt className="text-xs font-semibold text-zinc-500">조회 체인</dt>
                <dd className="flex items-center gap-2 text-[13px] text-zinc-700">
                  <span className="flex" aria-hidden="true">
                    {EVM_CHAIN_IDS.map((chainId) => (
                      <span key={chainId} className="-ml-1 flex rounded-full ring-2 ring-zinc-50 first:ml-0">
                        <ChainIcon chainId={chainId} size={20} />
                      </span>
                    ))}
                  </span>
                  EVM {EVM_CHAIN_IDS.length}곳
                </dd>
              </div>
            </dl>
            <div className="flex gap-2.5 rounded-[14px] bg-amber-50 px-3.5 py-3">
              <Info aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-amber-600" />
              <p className="text-[13px] leading-[19px] text-amber-900">
                서명하지 않으므로 <strong className="font-bold">미검증</strong>으로 표시됩니다. 거래 조회와 계산은 이용할 수 있습니다. 지갑 소유 확인은 지갑 화면에서 진행할 수 있습니다.
              </p>
            </div>
            {error && <InlineAlert tone="error">{error}</InlineAlert>}
            <button type="button" className={CTA_CLASS} disabled={isRegistering} onClick={registerAddress}>
              {isRegistering ? "주소 등록 중..." : "추가하고 거래 불러오기"}
            </button>
          </div>
        ) : null}
      </BottomSheet>
    </main>
  );
}

function StepHeading({
  eyebrow,
  title,
  body,
  trailing,
}: {
  eyebrow: string;
  title: string;
  body?: string | null;
  trailing?: React.ReactNode;
}) {
  return (
    <header className="mt-5 px-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-primary-500">{eyebrow}</p>
        {trailing}
      </div>
      <h1 className="mt-3 whitespace-pre-line text-[26px] font-bold leading-[34px] tracking-tight text-zinc-900">{title}</h1>
      {body ? <p className="mt-3 text-[15px] leading-[23px] text-zinc-600">{body}</p> : null}
    </header>
  );
}

function InlineAlert({ tone, children }: { tone: "error" | "info"; children: React.ReactNode }) {
  const Icon = tone === "error" ? AlertCircle : Info;
  return (
    <p role="alert" className={`flex items-start gap-2 px-1 text-[13px] leading-[19px] ${tone === "error" ? "text-red-600" : "text-amber-700"}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 wrap-anywhere">{children}</span>
    </p>
  );
}

function MethodStep({
  adding,
  flowLabel,
  countryCode,
  error,
  provenance,
  onAddress,
  onSiwe,
}: {
  adding: boolean;
  flowLabel: string;
  countryCode: string | null;
  error: string | null;
  provenance: Provenance;
  onAddress: () => void;
  onSiwe: () => void;
}) {
  return (
    <>
      <StepHeading
        eyebrow={`${flowLabel} 1/3`}
        title={adding ? "지갑 추가 방식 선택" : "지갑 연결 방식 선택"}
        body={
          (adding ? "지갑을 추가하면 해당 지갑의 거래를 함께 조회합니다. 로그인 상태와 기존 등록 지갑은 유지됩니다. " : "") +
          "두 방식 모두 거래 내역을 조회할 수 있습니다. 지갑 서명 방식은 지갑 소유 확인을 함께 진행합니다." +
          (countryCode ? ` 거주국 ${countryCode} 본인 확인이 완료되었습니다.` : "")
        }
        trailing={<ProvenanceChip provenance={provenance} />}
      />

      <div className="mt-7 flex flex-col gap-3 px-5">
        <MethodRow
          icon={<ClipboardPaste aria-hidden="true" className="size-[22px]" />}
          iconClass="bg-primary-50 text-primary-500"
          title="주소로 추가"
          badge={<span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-[11px] font-bold text-primary-600">추천</span>}
          description="공개 주소로 지갑 등록"
          onClick={onAddress}
        />
        <MethodRow
          icon={<KeyRound aria-hidden="true" className="size-[22px]" />}
          iconClass="bg-zinc-100 text-zinc-700"
          title="브라우저 지갑으로 연결"
          description="MetaMask 앱·브라우저 지갑 서명으로 소유 확인"
          onClick={onSiwe}
        />
        {/* 거래소 연동은 아직 파이프라인이 없다. 되는 척하는 입력을 두지 않고 준비 중임만 알린다. */}
        <div data-surface="exchange-coming-soon" aria-disabled="true" className="rounded-2xl bg-white p-4 shadow-card">
          <div className="flex items-center gap-3.5 opacity-60">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-zinc-100 text-zinc-500">
              <Building2 aria-hidden="true" className="size-[22px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-base font-bold text-zinc-900">거래소 계정 연동</p>
                <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] font-bold text-zinc-500">곧 지원</span>
              </div>
              <p className="mt-0.5 text-[13px] leading-[19px] text-zinc-500">지갑 밖 거래소 거래도 함께 보는 기능은 준비 중이에요</p>
            </div>
          </div>
          <ul aria-label="지원 예정 거래소" className="mt-3 flex flex-wrap gap-1.5">
            {EXCHANGES.map((exchange) => (
              <li key={exchange.id} className="rounded-full bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-400">
                {exchange.name}
              </li>
            ))}
          </ul>
        </div>
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>

      <p className="mt-5 flex items-start gap-2.5 px-5 text-xs leading-[18px] text-zinc-400">
        <ShieldCheck aria-hidden="true" className="mt-px size-4 shrink-0" />
        공개 주소만 사용합니다. 개인키 입력이나 자산 전송을 요청하지 않습니다.
      </p>
    </>
  );
}

function MethodRow({
  icon,
  iconClass,
  title,
  badge,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  badge?: React.ReactNode;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[76px] w-full items-center gap-3.5 rounded-2xl bg-white p-4 text-left shadow-card transition-colors active:bg-zinc-50"
    >
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-[14px] ${iconClass}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-base font-bold text-zinc-900">{title}</span>
          {badge}
        </span>
        <span className="mt-0.5 block text-[13px] leading-[19px] text-zinc-500">{description}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-zinc-400" />
    </button>
  );
}

function AddressStep({
  flowLabel,
  value,
  touched,
  assessment,
  error,
  onChange,
  onBlur,
  onClear,
  onPaste,
  onNext,
}: {
  flowLabel: string;
  value: string;
  touched: boolean;
  assessment: WalletAddressAssessment;
  error: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
  onClear: () => void;
  onPaste: () => void;
  onNext: () => void;
}) {
  const valid = assessment.kind === "valid";
  // 타이핑 중인 미완성 입력은 포커스가 떠난 뒤에만 형식 오류로 말한다.
  const showFormat = assessment.kind === "format" || (assessment.kind === "typing" && touched);
  const problem = assessment.kind === "checksum" || assessment.kind === "duplicate" || assessment.kind === "ens" || showFormat;
  const borderClass = problem ? "border-red-400" : valid ? "border-primary-500" : "border-zinc-200 focus-within:border-primary-500";

  return (
    <>
      <StepHeading
        eyebrow={`${flowLabel} 2/3`}
        title={"지갑 주소를\n붙여넣어 주세요"}
        body={assessment.kind === "empty" ? "0x로 시작하는 42자리 EVM 지갑 주소를 입력해 주세요. 등록한 주소로 지원 네트워크의 거래를 조회합니다." : null}
      />

      <div className="mt-6 flex flex-col gap-3 px-5">
        <label htmlFor="watch-address" className="sr-only">
          지갑 주소
        </label>
        <div className={`flex min-h-14 items-center gap-2.5 rounded-[14px] border-[1.5px] bg-white px-3.5 py-3 ${borderClass}`}>
          <input
            id="watch-address"
            className="min-w-0 flex-1 bg-transparent font-mono text-sm leading-5 text-zinc-900 outline-none placeholder:text-zinc-400"
            autoComplete="off"
            autoFocus
            spellCheck={false}
            placeholder="0x…"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
          />
          {value.length > 0 ? (
            <button
              type="button"
              aria-label="입력 지우기"
              onClick={onClear}
              className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          ) : null}
        </div>

        {assessment.kind === "checksum" ? (
          <InlineAlert tone="error">주소의 검증값이 일치하지 않습니다. 복사한 지갑 주소가 정확한지 확인해 주세요.</InlineAlert>
        ) : showFormat ? (
          <InlineAlert tone="error">0x로 시작하는 42자리 주소를 입력해 주세요.</InlineAlert>
        ) : assessment.kind === "ens" ? (
          <InlineAlert tone="info">ENS 이름은 지원하지 않습니다. 0x로 시작하는 지갑 주소를 입력해 주세요.</InlineAlert>
        ) : assessment.kind === "duplicate" ? (
          <InlineAlert tone="info">
            이미 등록된 지갑입니다.{" "}
            <Link href="/wallets" className="font-semibold text-primary-600 underline-offset-2 hover:underline">
              지갑 목록에서 보기
            </Link>
          </InlineAlert>
        ) : null}
        {error && <InlineAlert tone="error">{error}</InlineAlert>}

        {valid ? (
          <div className="flex items-center gap-2 rounded-[14px] bg-primary-50 px-3.5 py-3">
            <Check aria-hidden="true" className="size-[18px] shrink-0 text-primary-500" strokeWidth={2.5} />
            <div>
              <p className="text-sm font-bold text-primary-600">EVM 주소 확인 완료</p>
              <p className="text-xs leading-[17px] text-zinc-700">체크섬 일치 · 처음 등록하는 주소</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onPaste}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary-50 px-3 text-[13px] font-semibold text-primary-600"
            >
              <ClipboardPaste aria-hidden="true" className="size-[15px]" />
              클립보드에서 붙여넣기
            </button>
          </div>
        )}
      </div>

      {valid ? (
        <section className="mt-6 px-5" aria-label="조회할 체인">
          <p className="text-[13px] font-semibold text-zinc-500">거래 조회 대상 네트워크</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {EVM_CHAIN_IDS.map((chainId) => (
              <li
                key={chainId}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-full bg-white pl-2 pr-3 text-[13px] font-semibold text-zinc-700 ring-1 ring-inset ring-zinc-200"
              >
                <ChainIcon chainId={chainId} size={20} />
                {chainLabel(chainId)}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-[18px] text-zinc-400">
            등록한 주소로 아래 네트워크의 거래를 조회합니다. 거래가 없는 네트워크는 결과에서 제외됩니다.
          </p>
        </section>
      ) : (
        <section className="mt-7 px-5">
          <p className="text-[13px] font-semibold text-zinc-500">어디서 주소를 찾나요?</p>
          <ul className="mt-2.5 flex flex-col gap-1.5 text-[13px] leading-[19px] text-zinc-600">
            <li className="flex gap-2">
              <span className="text-zinc-400">·</span>MetaMask · Rabby: 상단 계정 이름을 눌러 주소 복사
            </li>
            <li className="flex gap-2">
              <span className="text-zinc-400">·</span>Ledger · Trezor: 앱의 계정 화면에서 “Receive” 주소
            </li>
            <li className="flex gap-2">
              <span className="text-zinc-400">·</span>거래소 출금 내역의 “받는 주소”도 그 지갑의 주소예요
            </li>
          </ul>
        </section>
      )}

      <div className="mt-auto px-5 pt-6">
        <button type="button" className={CTA_CLASS} disabled={!valid} onClick={onNext}>
          다음
        </button>
      </div>
    </>
  );
}

function WalletWaitHint({ kind }: { kind: "connect" | "sign" }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 5000);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div role="status" className="flex gap-2.5 rounded-[14px] bg-zinc-100 px-3.5 py-3">
      <Info aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-zinc-600" />
      <p className="text-[13px] leading-[19px] text-zinc-700">
        {kind === "connect"
          ? "MetaMask 앱 또는 지갑 확장 프로그램을 열어 이 사이트의 연결 요청을 확인해 주세요. ‘연결(Connect)’ 버튼이 보이면 눌러 주세요."
          : "MetaMask 앱 또는 지갑 확장 프로그램을 열어 서명 요청을 승인해 주세요. 승인 후 이 브라우저로 돌아오면 확인을 이어갑니다."}
      </p>
    </div>
  );
}

function SiweStep({
  flowLabel,
  account,
  boundAddress,
  error,
  isConnecting,
  signingPhase,
  onConnect,
  onConnectMetaMask,
  onSign,
  onFallback,
}: {
  flowLabel: string;
  account: WalletAccount | null;
  boundAddress: string | null;
  error: string | null;
  isConnecting: boolean;
  signingPhase: SigningPhase;
  onConnect: () => void;
  onConnectMetaMask: () => void;
  onSign: () => void;
  onFallback: () => void;
}) {
  const isSigning = signingPhase !== "idle";
  const signatureReceived = signingPhase === "verifying" || signingPhase === "redirecting";
  const duplicate = account !== null && isSameAddress(account.address, boundAddress);
  const timeline: Array<{ label: string; state: "done" | "active" | "pending"; note?: string }> = [
    { label: "지갑 연결 승인", state: account ? "done" : "active", note: account ? "완료" : isConnecting ? "지갑 응답 대기 중…" : undefined },
    { label: "메시지 서명", state: signatureReceived ? "done" : account ? "active" : "pending", note: signatureReceived ? "승인 완료" : isSigning ? SIGNING_LABELS[signingPhase] : undefined },
    { label: "서버 확인", state: signingPhase === "redirecting" ? "done" : signingPhase === "verifying" ? "active" : "pending" },
    { label: "거래 불러오기", state: signingPhase === "redirecting" ? "active" : "pending", note: signingPhase === "redirecting" ? "네트워크별 조회 화면을 준비하고 있습니다" : undefined },
  ];

  return (
    <>
      <StepHeading
        eyebrow={`${flowLabel} 2/3`}
        title={signingPhase === "redirecting" ? "거래 조회 화면을\n준비하고 있습니다" : signingPhase === "verifying" ? "서명을 확인하고\n있습니다" : account ? "지갑 앱에서 서명을\n승인해 주세요" : "브라우저 지갑을\n연결해 주세요"}
        body="서명은 지갑 소유 확인에 사용됩니다. 네트워크 수수료가 발생하거나 자산이 전송되지 않습니다."
      />

      <div className="mt-7 flex flex-col gap-3 px-5">
        {account ? (
          <div className="flex items-center gap-3 rounded-card bg-white p-5 shadow-card">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-zinc-900 text-white">
              <KeyRound aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[15px] font-bold text-zinc-900">
                연결된 지갑
                <span className="flex items-center gap-1 text-xs font-medium text-zinc-500">
                  <ChainIcon chainId={account.chainId} />
                  {chainLabel(account.chainId)}
                </span>
              </p>
              {/* 주소는 줄여 쓰지 않는다 — 서명 직전에는 어느 계정인지 끝자리까지 대조할 수 있어야 한다. */}
              <p className="mt-1 break-all font-mono text-xs text-zinc-500">{account.address}</p>
            </div>
          </div>
        ) : null}

        <ol className="mt-1 flex flex-col">
          {timeline.map((item, index) => (
            <li key={item.label} className="flex items-start gap-3.5">
              <span className="flex flex-col items-center">
                <span
                  className={`flex size-6 items-center justify-center rounded-full ${
                    item.state === "done" ? "bg-primary-500 text-white" : item.state === "active" ? "border-2 border-primary-500" : "border-2 border-zinc-200"
                  }`}
                >
                  {item.state === "done" ? <Check aria-hidden="true" className="size-3.5" strokeWidth={3} /> : null}
                  {item.state === "active" ? <span className="size-2 rounded-full bg-primary-500" /> : null}
                </span>
                {index < timeline.length - 1 ? <span aria-hidden="true" className="h-7 w-0.5 bg-zinc-200" /> : null}
              </span>
              <span className="pt-0.5">
                <span className={`block text-[15px] font-semibold ${item.state === "pending" ? "text-zinc-400" : "text-zinc-900"}`}>{item.label}</span>
                {item.note ? (
                  <span className={`block text-[13px] ${item.state === "done" ? "text-primary-500" : "text-zinc-500"}`}>{item.note}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>

        {duplicate ? (
          <InlineAlert tone="info">이미 등록된 지갑입니다. 지갑 확장 프로그램에서 다른 계정으로 바꾼 뒤 다시 시도해 주세요.</InlineAlert>
        ) : null}
        {error && <InlineAlert tone="error">{error}</InlineAlert>}

        {signatureReceived ? (
          <div className="flex gap-2.5 rounded-[14px] bg-zinc-100 px-3.5 py-3">
            <Info aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-zinc-600" />
            <p className="text-[13px] leading-[19px] text-zinc-700">
              {signingPhase === "redirecting"
                ? "지갑 확인이 완료됐습니다. 잠시 후 네트워크별 거래 조회 진행 상황이 표시됩니다."
                : "지갑에서 승인한 서명을 서버에서 확인하고 있습니다. 추가 서명은 필요하지 않습니다."}
            </p>
          </div>
        ) : signingPhase === "signing" ? <WalletWaitHint key="sign" kind="sign" />
          : !account && isConnecting ? <WalletWaitHint key="connect" kind="connect" /> : null}
      </div>

      <div className="mt-auto flex flex-col gap-2.5 px-5 pt-6">
        {account ? (
          <button type="button" className={CTA_CLASS} disabled={isSigning || duplicate} onClick={onSign}>
            {isSigning && <LoaderCircle aria-hidden="true" className="mr-2 size-5 animate-spin" />}
            <span role={isSigning ? "status" : undefined}>{SIGNING_LABELS[signingPhase]}</span>
          </button>
        ) : (
          <>
            <button type="button" className={CTA_CLASS} disabled={isConnecting} onClick={onConnectMetaMask}>
              {isConnecting ? "지갑 응답 대기 중…" : "MetaMask로 연결"}
            </button>
            <button type="button" className="flex h-12 items-center justify-center rounded-[14px] border border-zinc-200 font-semibold disabled:opacity-50" disabled={isConnecting} onClick={onConnect}>
              지갑 연결하기
            </button>
            <p className="text-xs leading-5 text-zinc-500">모바일에서는 MetaMask로 연결을 선택해 주세요. 앱에서 연결을 승인한 뒤 이 브라우저로 돌아와 ‘서명하고 추가’를 눌러 주세요. 앱이 열리지 않으면 연결 창의 안내를 따르세요.</p>
          </>
        )}
        <button type="button" onClick={onFallback} className="flex h-11 items-center justify-center text-[15px] font-semibold text-primary-500">
          대신 주소만 붙여넣기
        </button>
      </div>
    </>
  );
}
