"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { demoDefiPositions, demoNftHoldings, holdingsFromDto, walletChains } from "@/lib/wallet/holdings";
import { HoldingsFetchError } from "@/lib/adapters/http/holdings-provider.http";
import { useHoldings, useRegisteredWallets, useRemoveWallet } from "@/lib/queries/holdings";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { WalletPortfolio } from "@/components/wallet/wallet-portfolio";
import { NotFoundView } from "@/components/ui/not-found-view";
import { Skeleton } from "@/components/ui/skeleton";
import { WalletMark } from "@/components/wallet/wallet-mark";
import { walletLabel } from "@/components/wallet/wallet-verification-badge";
import { shortHash } from "@/lib/format";

/**
 * 지갑 하나의 포트폴리오(`/wallets/[address]`). 뒤로가기는 지갑 목록이다.
 *
 * 토큰 보유분은 `/api/portfolio/holdings?address=`(mock 모드면 데모 지갑, ON 모드면 BE 실잔액)에서 온다. NFT·디파이는
 * 아직 데모 예시다. 등록 방식(배지)은 목록과 같은 소스(`/api/auth/wallets`)에서 읽어 두 화면이 어긋나지 않는다.
 * 체인은 세션이 아니라 보유 자산에서 파생한다 — EVM 주소는 체인 불문 동일하고, 세션 계약에는 chainId가 없다.
 *
 * 조회 중·실패는 빈 지갑과 다르다. 이전 캐시를 "지금 것"처럼 단정하지 않고 각 상태를 따로 그린다.
 * 등록하지 않은 주소는 404 화면이다 — 서버가 아니라 목록이 판정한다(주소 형식은 라우트가 먼저 거른다).
 */
export function WalletHome({ walletAddress }: { walletAddress: string }) {
  const router = useRouter();
  const wallets = useRegisteredWallets();
  // 등록 해제. 확인 시트를 거쳐야 하고, 끝나면 목록으로 돌아간다 — 지운 지갑의 화면에 머무를 이유가 없다.
  const removal = useRemoveWallet();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const registered = useMemo(() => wallets.data?.wallets.find((wallet) => wallet.walletAddress.toLowerCase() === walletAddress.toLowerCase()) ?? null, [wallets.data, walletAddress]);
  const query = useHoldings(walletAddress);
  const provenance = query.data?.provenance ?? "mock";
  const holdings = useMemo(() => (query.data ? holdingsFromDto(query.data.data.holdings) : []), [query.data]);
  // NFT·디파이는 mock(데모 지갑)에서만 그린다. 실지갑에 데모 NFT를 섞으면 상단 총액이 존재하지 않는 2만 달러를 말한다.
  const nfts = useMemo(() => (provenance === "mock" ? demoNftHoldings() : []), [provenance]);
  const defi = useMemo(() => (provenance === "mock" ? demoDefiPositions() : []), [provenance]);
  // 자산이 실제로 놓여 있는 체인. 불러오기 모달과 같은 소스라 화면 간 체인 목록이 어긋나지 않는다.
  const chains = useMemo(() => walletChains(holdings, nfts, defi), [holdings, nfts, defi]);

  // 목록이 답했는데 이 주소가 없다: 잘못된 링크거나 다른 계정의 지갑이다.
  if (wallets.data !== undefined && registered === null) {
    return <NotFoundView title="등록하지 않은 지갑입니다" body="이 주소는 현재 계정에 등록되어 있지 않습니다. 지갑 목록에서 고르거나 새로 등록해 주세요." code={walletAddress} />;
  }

  if (query.data === undefined) {
    if (query.isError) {
      const failure = describeFailure(query.error);
      return (
        <main data-surface="wallet-portfolio-error" className="min-h-dvh px-5 pb-6 pt-8">
          <Link href="/wallets" className="text-sm font-semibold text-zinc-500">← 지갑 목록</Link>
          <p className="mt-4 font-semibold text-zinc-900">보유 자산을 불러오지 못했습니다</p>
          <p className="mt-2 text-sm leading-6 text-zinc-600">{failure.message}</p>
          {failure.kind === "session" ? (
            <Link href="/login" className="mt-4 inline-block rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">
              다시 로그인
            </Link>
          ) : (
            <button type="button" onClick={() => void query.refetch()} className="mt-4 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">
              다시 시도
            </button>
          )}
        </main>
      );
    }
    return <WalletDetailLoading walletAddress={walletAddress} verification={registered?.verificationMethod ?? null} />;
  }
  // 데이터가 있는 채로 재조회 중이거나 배경 재조회가 실패한 경우: 이전 값을 지우지 않되 "지금 것"이라고 단정하지도 않는다.
  const freshness = query.isError ? "stale" : query.isFetching ? "refreshing" : undefined;

  // URL은 소문자 주소다. 화면에는 등록 시 저장된 체크섬 표기를 쓴다 — 복사한 주소가 원본과 같아야 한다.
  const displayAddress = registered?.walletAddress ?? query.data.data.walletAddresses[0] ?? walletAddress;

  const remove = () => {
    removal.mutate(displayAddress, {
      onSuccess: () => {
        setConfirmOpen(false);
        router.push("/wallets");
      },
    });
  };

  return (
    <>
    <WalletPortfolio
      address={displayAddress}
      chains={chains}
      tokens={holdings}
      nfts={nfts}
      defi={defi}
      provenance={query.data.provenance}
      asOf={query.data.data.asOf}
      coverage={{
        skippedChainIds: query.data.data.skippedChainIds,
        truncatedChainIds: query.data.data.truncatedChainIds,
        unresolvedCount: query.data.data.unresolvedCount,
        droppedCount: query.data.data.droppedCount,
      }}
      freshness={freshness}
      verification={registered?.verificationMethod ?? query.data.data.byWallet[0]?.verificationMethod ?? null}
      onRemove={() => setConfirmOpen(true)}
    />
    <BottomSheet open={confirmOpen} onClose={() => { if (!removal.isPending) setConfirmOpen(false); }} title="지갑 삭제">
      <h2 className="text-lg font-bold text-zinc-900">이 지갑을 삭제할까요?</h2>
      <p className="mt-1 break-all font-mono text-xs text-zinc-500">{displayAddress}</p>
      {/* 무엇이 사라지고 무엇이 남는지를 먼저 말한다 — "삭제"만 크게 띄우면 사용자는 거래까지 지워지는 줄 모른다. */}
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-zinc-600">
        <li>이 지갑에서 불러온 거래가 원장·세금 계산·리포트에서 빠집니다.</li>
        <li>직접 고친 분류·금액도 함께 사라집니다. 다시 등록하면 처음부터 다시 불러옵니다.</li>
        <li>다른 등록 지갑과 이 지갑 사이의 이동은 소유를 증명할 지갑이 없어져 일반 전송으로 다시 판정됩니다.</li>
        <li>체인에 이미 기록한 계산 근거는 지워지지 않습니다.</li>
      </ul>
      {removal.isError && <p role="alert" className="mt-3 text-sm text-red-600">{describeRemovalFailure(removal.error)}</p>}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setConfirmOpen(false)}
          disabled={removal.isPending}
          className="rounded-xl border border-zinc-200 py-3 font-semibold text-zinc-700 disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={removal.isPending}
          data-surface="wallet-remove-confirm"
          className="rounded-xl bg-red-600 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {removal.isPending ? "삭제하는 중…" : "삭제"}
        </button>
      </div>
    </BottomSheet>
    </>
  );
}

/** 등록 해제 실패를 사용자 말로. 코드가 없으면(네트워크 등) 다시 시도를 권한다. */
function describeRemovalFailure(error: unknown): string {
  const code = error instanceof HoldingsFetchError ? error.code : null;
  switch (code) {
    case "unauthorized":
      return "로그인이 만료되었습니다. 다시 로그인한 뒤 확인해 주세요.";
    case "wallet_not_found":
      return "이미 등록 해제된 지갑입니다. 지갑 목록을 새로고침해 주세요.";
    default:
      return "지갑을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

/** 조회 중. 이미 아는 것(주소·등록 방식)은 그대로 두고 값 자리만 스켈레톤이다. */
function WalletDetailLoading({ walletAddress, verification }: { walletAddress: string; verification: string | null }) {
  return (
    <main data-surface="wallet-portfolio-loading" className="min-h-dvh px-5 pb-6 pt-8" aria-busy="true">
      <div className="-ml-2 flex items-center gap-2">
        <Link href="/wallets" aria-label="지갑 목록으로" className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-600">
          <svg aria-hidden="true" width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </Link>
        <WalletMark size={28} />
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{walletLabel(verification)}</h1>
      </div>
      <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 font-mono text-sm text-zinc-700">{shortHash(walletAddress)}</p>
      <Skeleton className="mt-5 block h-10 w-44" />
      <p role="status" className="mt-2 text-xs text-zinc-400">온체인 잔액과 시세를 확인하는 중입니다… 최대 15초 걸릴 수 있습니다.</p>
      <ul className="mt-6 divide-y divide-zinc-100">
        {[0, 1, 2].map((row) => (
          <li key={row} className="flex items-center gap-3 py-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <span className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-5 w-14" /><Skeleton className="h-3.5 w-24" /></span>
            <span className="flex flex-col items-end gap-1.5"><Skeleton className="h-5 w-16" /><Skeleton className="h-3 w-28" /></span>
          </li>
        ))}
      </ul>
    </main>
  );
}

/**
 * 실패를 사용자 말로. 서버·BE의 message는 영어 원문이라 화면에 그대로 싣지 않고, 보존된 code로 고른다.
 * 세션 만료는 "다시 시도"로 풀리지 않으므로 로그인 경로를 준다.
 */
function describeFailure(error: unknown): { kind: "session" | "retry"; message: string } {
  const code = error instanceof HoldingsFetchError ? error.code : null;
  switch (code) {
    case "unauthorized":
      return { kind: "session", message: "로그인이 만료되었습니다. 다시 로그인한 뒤 확인해 주세요." };
    case "not_found":
      // 이 화면은 세션에 지갑이 있을 때만 열린다. 그런데 잔액 서버가 못 찾았다면 세션과 BE 저장소가 어긋난 것이다.
      return { kind: "session", message: "잔액 서버에서 이 지갑의 등록을 찾지 못했습니다. 다시 로그인한 뒤에도 같으면 지갑을 다시 등록해 주세요." };
    case "backend_endpoint_missing":
      return { kind: "retry", message: "잔액 서버가 아직 보유 자산 조회를 지원하지 않습니다. 서버 배포 버전을 확인해 주세요." };
    case "service_unavailable":
    case "upstream_unavailable":
      return { kind: "retry", message: "잔액 서버에서 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요." };
    case "rate_limited":
      return { kind: "retry", message: "조회가 너무 잦아 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요." };
    default:
      return { kind: "retry", message: "잠시 후 다시 시도해 주세요." };
  }
}
