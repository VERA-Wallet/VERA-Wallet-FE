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

export function ConnectWalletFlow({ walletPort = wagmiWalletPort, authClient = compositionAuthClient }: { walletPort?: WalletPort; authClient?: AuthClient }) {
  const router = useRouter();
  const [account, setAccount] = useState<WalletAccount | null>(() => walletPort.getAccount());
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSigning, setIsSigning] = useState(false);

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
      // "연결이 안 됐나"로 읽는다. `importing`을 달고 들어가 대시보드 위에 불러오기 모달을 띄운다.
      router.push("/dashboard?importing=1");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setIsSigning(false);
    }
  }

  return (
    <Card className="mt-8">
      <div data-surface="wallet-connect" className="flex items-center justify-between">
        <p className="font-semibold text-zinc-900">연결할 지갑</p>
        <MockProvenanceChip />
      </div>
      {account ? (
        <>
          <p className="mt-3 break-all font-mono text-xs text-zinc-600">{account.address}</p>
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
