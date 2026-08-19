"use client";

import { useMemo, useSyncExternalStore } from "react";

const STORAGE_KEY = "vw_hide_balances";

type HideBalancesStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => boolean;
  getServerSnapshot: () => boolean;
  update: (next: boolean) => void;
};

function readStored(storage: Storage): boolean {
  try {
    return storage.getItem(STORAGE_KEY) === "1";
  } catch {
    // 저장소를 못 읽어도(시크릿 모드 등) 화면은 계속 떠야 한다 — 기본값(끔)으로 진행한다.
    return false;
  }
}

function writeStored(storage: Storage, value: boolean): void {
  try {
    storage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // 저장 실패는 이번 세션에서 토글이 유지되지 않는다는 뜻일 뿐, 화면 동작을 막을 이유는 아니다.
  }
}

function createHideBalancesStore(storage: Storage | null): HideBalancesStore {
  const listeners = new Set<() => void>();
  // null은 "아직 저장소를 읽지 않았다"는 뜻이다. 스냅샷은 한 번 읽고 참조를 고정해야
  // `useSyncExternalStore`가 매 렌더 같은 값을 보고 무한 렌더로 빠지지 않는다.
  let snapshot: boolean | null = null;

  const getSnapshot = () => {
    if (snapshot === null) snapshot = storage ? readStored(storage) : false;
    return snapshot;
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot,
    getServerSnapshot: () => false,
    update: (next) => {
      snapshot = next;
      if (storage) writeStored(storage, next);
      for (const listener of listeners) listener();
    },
  };
}

/**
 * 잔액 가리기 토글.
 *
 * 저장소는 React 밖의 시스템이라 `useSyncExternalStore`로 읽는다(lib/exchange/use-exchange-links.ts와
 * 같은 패턴). 서버 스냅샷을 항상 false로 고정해 두면 하이드레이션은 서버와 같은 화면(꺼짐)에서
 * 시작하고, 그 직후 클라이언트 스냅샷으로 한 번만 갱신된다 — `useEffect` 안에서 `setState`를
 * 부르는 방식은 이 프로젝트 lint 규칙(`react-hooks/set-state-in-effect`)이 막는다.
 */
export function useHideBalances(storage?: Storage | null): [boolean, (next: boolean) => void] {
  const resolvedStorage = storage === undefined ? (typeof window === "undefined" ? null : window.localStorage) : storage;
  const store = useMemo(() => createHideBalancesStore(resolvedStorage), [resolvedStorage]);
  const hidden = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return [hidden, store.update];
}
