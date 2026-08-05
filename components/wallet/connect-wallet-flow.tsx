"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SiweMessage } from "siwe";
import { Card } from "@/components/ui/card";
import { MockProvenanceChip } from "@/components/ui/mock-provenance-chip";
import { chainLabel } from "@/lib/format";
import type { WalletAccount, WalletPort } from "@/lib/ports/wallet-port";
import { wagmiWalletPort } from "@/lib/wallet/wagmi-wallet-port";
import { authClient as compositionAuthClient } from "@/lib/composition-root.client";
import { AuthClientError, type AuthClient } from "@/lib/ports/auth-client";

function errorMessage(cause: unknown) {
  if (cause instanceof AuthClientError) {
    if (cause.status === 422) return "인증 요청 불일치";
    if (cause.status === 410) return "만료됨 — 다시 시도";
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
      router.push("/dashboard");
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
          <p className="mt-1 text-sm text-zinc-500">{chainLabel(account.chainId)}</p>
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
