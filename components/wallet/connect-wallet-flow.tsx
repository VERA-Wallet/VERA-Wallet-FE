"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiweMessage } from "siwe";
import { Card } from "@/components/ui/card";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { ChainIcon } from "@/components/ui/chain-icon";
import { chainLabel } from "@/lib/format";
import type { WalletAccount, WalletPort } from "@/lib/ports/wallet-port";
import { wagmiWalletPort } from "@/lib/wallet/wagmi-wallet-port";
import { parseWalletAddress } from "@/lib/wallet/address";
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
    if (cause.code === "challenge_expired") return "만료됨 — 다시 시도";
    if (cause.status === 401) return "서명을 확인할 수 없습니다.";
  }
  return cause instanceof Error ? cause.message : "인증 중 오류가 발생했습니다.";
}

function isSameAddress(left: string, right: string | null) {
  return right !== null && left.toLowerCase() === right.toLowerCase();
}

type RegistrationTab = "watch" | "siwe";

/**
 * 지갑을 등록한다. 방법이 둘이고 커버리지가 다르다.
 *
 * - **주소 입력(기본)**: 거래 조회에는 주소만 있으면 되므로 하드웨어·컨트랙트·모바일·과거 지갑이 전부 들어온다.
 *   대신 소유 증명이 없어 `watch_only`로 남는다.
 * - **소유 증명(SIWE)**: 브라우저에 꽂힌 키로 서명해 소유를 증명한다. 증빙이 필요한 자료는 이쪽만 쓴다.
 *
 * 기본을 주소 입력으로 두는 이유: 서명은 "지금 이 브라우저에 있는 키"만 커버하는데 세금은 과거 전체를 봐야 한다.
 * 서명 가능한 지갑은 탭 한 번으로 증명하면 되지만, 서명 불가능한 지갑은 주소 입력이 없으면 등록할 길 자체가 없다.
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
}: {
  walletPort?: WalletPort;
  authClient?: AuthClient;
  redirectTo?: string;
  /** 이미 등록된 지갑 주소. 같은 주소를 다시 등록하면 서버가 upsert라 아무 일도 안 일어나므로 미리 막는다. */
  boundAddress?: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<RegistrationTab>("watch");
  const [account, setAccount] = useState<WalletAccount | null>(() => walletPort.getAccount());
  const [addressInput, setAddressInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  function switchTab(next: RegistrationTab) {
    // 오류는 탭에 딸린 것이다. 남겨 두면 주소 형식 오류가 서명 화면에 떠 있게 된다.
    setError(null);
    setTab(next);
  }

  async function registerAddress() {
    setError(null);
    const parsed = parseWalletAddress(addressInput);
    if (!parsed.ok) {
      setError(parsed.reason === "checksum"
        ? "주소의 체크섬이 맞지 않습니다. 한 글자라도 잘못 붙여넣지 않았는지 확인해 주세요."
        : "0x로 시작하는 40자리 주소를 입력해 주세요.");
      return;
    }
    if (isSameAddress(parsed.address, boundAddress)) {
      setError("이미 등록된 지갑입니다. 다른 주소를 입력해 주세요.");
      return;
    }
    setIsRegistering(true);
    try {
      await authClient.registerWatchWallet({ address: parsed.address });
      router.push(redirectTo);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setIsRegistering(false);
    }
  }

  async function connectWallet() {
    setError(null);
    if (!(window as Window & { ethereum?: unknown }).ethereum) {
      setError("브라우저 지갑을 찾을 수 없습니다. 지갑 확장 프로그램을 설치하거나 활성화하세요.");
      return;
    }
    setIsConnecting(true);
    try {
      setAccount(await walletPort.connect());
    } catch {
      setError("지갑 연결을 완료하지 못했습니다.");
    } finally {
      setIsConnecting(false);
    }
  }

  async function signIn() {
    if (!account) return;
    setError(null);
    // 확장 프로그램은 이미 승인된 오리진에서 활성 계정을 그대로 돌려준다. 그대로 서명하면 같은 지갑을
    // 다시 등록하는 셈이고 서버는 upsert라 조용히 아무 일도 일어나지 않는다 — 서명을 요구하기 전에 끊는다.
    if (isSameAddress(account.address, boundAddress)) {
      setError("이미 등록된 지갑입니다. 지갑 확장 프로그램에서 다른 계정으로 바꾼 뒤 다시 시도해 주세요.");
      return;
    }
    setIsSigning(true);
    try {
      const nonce = await authClient.requestNonce({ chainId: account.chainId });
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
      const signature = await walletPort.signMessage(message);
      await authClient.verify({ message, signature });
      // 서명이 끝나도 인덱서 동기화는 남아 있다. 대시보드로 그냥 보내면 사용자는 빈 화면을 먼저 보고
      // "연결이 안 됐나"로 읽는다. 온보딩 기본값은 `importing`을 달고 들어가 불러오기 모달을 띄운다.
      router.push(redirectTo);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setIsSigning(false);
    }
  }

  return (
    <Card className="mt-8">
      <div data-surface="wallet-connect" className="flex items-center justify-between">
        <p className="font-semibold text-zinc-900">등록할 지갑</p>
        <MockProvenanceChip />
      </div>

      <div className="mt-4 flex gap-2" role="tablist" aria-label="지갑 등록 방법">
        {([["watch", "주소 입력"], ["siwe", "소유 증명"]] as const).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => switchTab(value)}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold ${tab === value ? "bg-primary-500 text-white" : "bg-zinc-100 text-zinc-700"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "watch" ? (
        <div data-surface="wallet-watch">
          <label className="mt-5 block text-sm font-medium text-zinc-700" htmlFor="watch-address">지갑 주소</label>
          <input
            id="watch-address"
            className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-3 font-mono text-sm text-zinc-900"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x…"
            value={addressInput}
            onChange={(event) => setAddressInput(event.target.value)}
          />
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            주소만으로 거래 내역을 불러옵니다. 서명하지 않으므로 소유는 증명되지 않고 <strong className="font-semibold">미검증</strong>으로 표시됩니다.
          </p>
          <button
            className="mt-4 w-full rounded-xl bg-primary-500 py-3.5 font-semibold text-white disabled:opacity-50"
            disabled={isRegistering || addressInput.trim().length === 0}
            onClick={registerAddress}
            type="button"
          >
            {isRegistering ? "주소 등록 중..." : "이 주소로 계속"}
          </button>
        </div>
      ) : account ? (
        <>
          <p className="mt-4 break-all font-mono text-xs text-zinc-600">{account.address}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500">
            <ChainIcon chainId={account.chainId} />
            {chainLabel(account.chainId)}
          </p>
          <p className="mt-4 text-sm leading-6 text-zinc-600">
            서명은 지갑 소유 확인에만 쓰이며 자산을 옮기지 않습니다.
          </p>
          <button className="mt-4 w-full rounded-xl bg-primary-500 py-3.5 font-semibold text-white disabled:opacity-50" disabled={isSigning} onClick={signIn} type="button">
            {isSigning ? "지갑에서 서명 대기 중..." : "SIWE 서명으로 계속"}
          </button>
        </>
      ) : (
        <button className="mt-5 w-full rounded-xl bg-primary-500 py-3.5 font-semibold text-white disabled:opacity-50" disabled={isConnecting} onClick={connectWallet} type="button">
          {isConnecting ? "지갑 응답 대기 중..." : "지갑 연결하기"}
        </button>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </Card>
  );
}
