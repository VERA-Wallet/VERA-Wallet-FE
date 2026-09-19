"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Card } from "@/components/ui/card";
import { ExchangeMark } from "@/components/ui/exchange-mark";
import { MockProvenanceChip } from "@/components/ui/provenance-chip";
import { formatDate } from "@/lib/format";
import {
  EXCHANGES,
  OAUTH_CREDENTIAL_LABEL,
  exchangeById,
  maskApiKey,
  type ExchangeDefinition,
} from "@/lib/exchange/mock-links";
import { useExchangeLinks } from "@/lib/exchange/use-exchange-links";

const EMPTY_FORM = { apiKey: "", secretKey: "", passphrase: "" };

/** 연동 전 행이 보여주는 것은 "무엇을 요구하는가"다. 눌러 보기 전에 준비물을 알 수 있어야 한다. */
function methodLabel(exchange: ExchangeDefinition): string {
  if (exchange.method === "oauth") return "거래소 로그인 승인";
  return exchange.requiresPassphrase ? "조회 전용 API 키 + 패스프레이즈" : "조회 전용 API 키";
}

const inputClass = "mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm";

/**
 * 거래소 계정 연동 패널 — **화면 시연**.
 *
 * 지갑은 SIWE로 소유를 증명하지만 거래소 계정에는 그런 서명이 없다.
 * 실제 제품에서는 조회 전용 키(또는 OAuth 조회 권한)를 서버가 받아 보관하고,
 * 체결·입출금을 지갑 이벤트와 같은 스키마로 정규화해야 대시보드가 한 몸이 된다.
 * 그 파이프라인이 붙기 전이라 이 패널은 **연결 흐름만** 재현한다:
 * 요구 권한, 입력 폼, 왕복 대기, 연동됨/해제 상태.
 *
 * 대신 시연이라는 사실을 화면에서 지우지 않는다 — mock 배지와 고지 문구가 같은 카드 안에 있고,
 * 입력한 비밀값은 서버로도 저장소로도 나가지 않는다(남는 것은 가려진 표시 문자열뿐).
 */
export function ExchangeConnectPanel({
  linkDelayMs = 700,
  storage,
}: {
  linkDelayMs?: number;
  /** 저장소 주입구. 기본값은 브라우저 로컬 저장소이며, 없는 환경에서는 화면 상태로만 남는다. */
  storage?: Storage | null;
}) {
  const [links, commit] = useExchangeLinks(storage);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 왕복 대기 중에 화면을 떠나면 타이머만 남는다. 언마운트 때 끊는다.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const open = openId ? exchangeById(openId) : null;
  const linkOf = (id: string) => links.find((link) => link.exchangeId === id) ?? null;


  function openSheet(exchange: ExchangeDefinition) {
    setForm(EMPTY_FORM);
    setNotice(null);
    setOpenId(exchange.id);
  }

  function closeSheet() {
    // 왕복 중에 닫으면 "연동 확인 중"이 사라진 자리에서 결과만 튀어나온다.
    if (pending) return;
    setOpenId(null);
    setForm(EMPTY_FORM);
  }

  const ready =
    !!open &&
    (open.method === "oauth" ||
      (form.apiKey.trim() !== "" &&
        form.secretKey.trim() !== "" &&
        (!open.requiresPassphrase || form.passphrase.trim() !== "")));

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!open || !ready || pending) return;
    const exchange = open;
    // 가리는 일은 저장 직전에 한 번만 한다. 원문 키는 이 함수 밖으로 나가지 않는다.
    const credentialLabel = exchange.method === "oauth" ? OAUTH_CREDENTIAL_LABEL : maskApiKey(form.apiKey);
    setPending(true);
    // 실제 연동에는 왕복이 있다. 즉시 "연동됨"으로 바꾸면 대기·실패를 보여줄 자리가 사라진다.
    timer.current = setTimeout(() => {
      commit((current) => [
        ...current.filter((link) => link.exchangeId !== exchange.id),
        { exchangeId: exchange.id, credentialLabel, connectedAt: new Date().toISOString(), scope: "read-only" },
      ]);
      setPending(false);
      setOpenId(null);
      setForm(EMPTY_FORM);
      setNotice(`${exchange.name} 연동됨 — 조회 전용 권한입니다.`);
    }, linkDelayMs);
  }

  function disconnect(exchange: ExchangeDefinition) {
    commit((current) => current.filter((link) => link.exchangeId !== exchange.id));
    setNotice(`${exchange.name} 연동을 해제했습니다.`);
  }

  return (
    <Card className="mt-4">
      <div data-surface="exchange-connect" className="flex items-center justify-between">
        <p className="font-semibold text-zinc-900">거래소 계정 연동</p>
        <MockProvenanceChip />
      </div>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        지갑 밖 거래소 거래도 함께 보려면 조회 전용 권한으로 연동합니다. 출금·주문 권한은 요구하지 않습니다.
      </p>
      <p className="mt-1 text-sm leading-6 text-zinc-500">
        지금은 연결 흐름만 보여주는 시연 화면입니다. 실제 거래소에 접속하지 않고, 입력한 키는 서버로 전송되지 않습니다.
      </p>

      <ul aria-label="연동할 거래소" className="mt-4 divide-y divide-zinc-100 border-t border-zinc-100">
        {EXCHANGES.map((exchange) => {
          const link = linkOf(exchange.id);
          return (
            <li key={exchange.id} className="flex items-center gap-3 py-3">
              <ExchangeMark exchange={exchange} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 font-semibold text-zinc-900">
                  {exchange.name}
                  <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
                    {exchange.region}
                  </span>
                </p>
                {link ? (
                  <p className="mt-0.5 text-xs leading-5 text-zinc-500">
                    <span className="font-semibold text-primary-600">연동됨</span> · 조회 전용 · {link.credentialLabel} ·{" "}
                    {formatDate(link.connectedAt)}
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs leading-5 text-zinc-500">{methodLabel(exchange)}</p>
                )}
              </div>
              {link ? (
                <button
                  type="button"
                  aria-label={`${exchange.name} 연동 해제`}
                  className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600"
                  onClick={() => disconnect(exchange)}
                >
                  연동 해제
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={`${exchange.name} 연동하기`}
                  className="shrink-0 rounded-lg border border-primary-500 px-3 py-1.5 text-xs font-semibold text-primary-600"
                  onClick={() => openSheet(exchange)}
                >
                  연동
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <p role="status" className="mt-3 min-h-5 text-xs text-zinc-500">
        {notice ?? (links.length > 0 ? `연동된 거래소 ${links.length}곳 · 모두 조회 전용입니다.` : "")}
      </p>

      <BottomSheet open={open !== null} onClose={closeSheet} title={open ? `${open.name} 연동` : "거래소 연동"}>
        {open ? (
          <form onSubmit={connect}>
            <div className="flex items-center gap-3">
              <ExchangeMark exchange={open} size={36} />
              <div>
                <p className="text-lg font-bold text-zinc-900">{open.name} 연동</p>
                <p className="text-xs text-zinc-500">{methodLabel(open)}</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-zinc-50 px-3 py-3">
              <p className="text-xs font-semibold text-zinc-700">요청하는 권한</p>
              <ul className="mt-1 grid gap-0.5 text-xs leading-5 text-zinc-600">
                <li>거래 내역 조회</li>
                <li>잔고 조회</li>
              </ul>
              <p className="mt-2 text-xs font-semibold text-zinc-700">요청하지 않는 권한</p>
              <ul className="mt-1 grid gap-0.5 text-xs leading-5 text-zinc-600">
                <li>출금·이체</li>
                <li>주문·거래 실행</li>
              </ul>
            </div>

            {open.method === "api-key" ? (
              <div className="mt-4 grid gap-3">
                <div>
                  <label htmlFor="exchange-api-key" className="text-sm font-medium text-zinc-700">
                    API 키
                  </label>
                  <input
                    id="exchange-api-key"
                    className={inputClass}
                    autoComplete="off"
                    placeholder="거래소에서 발급한 조회 전용 키"
                    value={form.apiKey}
                    onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="exchange-secret-key" className="text-sm font-medium text-zinc-700">
                    시크릿 키
                  </label>
                  <input
                    id="exchange-secret-key"
                    type="password"
                    className={inputClass}
                    autoComplete="off"
                    placeholder="발급 화면에서 한 번만 보이는 값"
                    value={form.secretKey}
                    onChange={(event) => setForm({ ...form, secretKey: event.target.value })}
                  />
                </div>
                {open.requiresPassphrase ? (
                  <div>
                    <label htmlFor="exchange-passphrase" className="text-sm font-medium text-zinc-700">
                      패스프레이즈
                    </label>
                    <input
                      id="exchange-passphrase"
                      type="password"
                      className={inputClass}
                      autoComplete="off"
                      placeholder="키 발급 때 직접 정한 문구"
                      value={form.passphrase}
                      onChange={(event) => setForm({ ...form, passphrase: event.target.value })}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-zinc-600">
                {open.name} 로그인 화면에서 조회 권한만 승인합니다. 키를 직접 입력하지 않습니다.
              </p>
            )}

            <p className="mt-3 text-xs leading-5 text-zinc-500">{open.hint}</p>
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              화면 시연용 연동입니다. 입력값은 어디로도 전송되지 않으며, 목록에는 가려진 형태만 남습니다.
            </p>

            <button
              type="submit"
              disabled={!ready || pending}
              className="mt-4 w-full rounded-xl bg-primary-500 py-3.5 font-semibold text-white disabled:opacity-50"
            >
              {pending
                ? open.method === "oauth"
                  ? "거래소 승인 대기 중..."
                  : "연동 확인 중..."
                : open.method === "oauth"
                  ? `${open.name} 로그인 후 승인`
                  : "연동하기"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={closeSheet}
              className="mt-2 w-full rounded-xl border border-zinc-300 py-3 font-semibold text-zinc-600 disabled:opacity-50"
            >
              취소
            </button>
          </form>
        ) : null}
      </BottomSheet>
    </Card>
  );
}
