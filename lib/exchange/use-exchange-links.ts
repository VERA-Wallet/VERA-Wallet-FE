import { useMemo, useSyncExternalStore } from "react";
import { loadExchangeLinks, saveExchangeLinks, type ExchangeLink } from "@/lib/exchange/mock-links";

/** 서버 렌더가 보는 값. 저장소는 브라우저에만 있으므로 서버는 항상 "연동 없음"을 그린다. */
const NO_LINKS: ExchangeLink[] = [];

type ExchangeLinkStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ExchangeLink[];
  getServerSnapshot: () => ExchangeLink[];
  update: (change: (current: ExchangeLink[]) => ExchangeLink[]) => void;
};

function createExchangeLinkStore(storage?: Storage | null): ExchangeLinkStore {
  const listeners = new Set<() => void>();
  // null은 "아직 저장소를 읽지 않았다"는 뜻이다. 스냅샷은 한 번 읽고 참조를 고정해야
  // `useSyncExternalStore`가 매 렌더 새 배열을 보고 무한 렌더로 빠지지 않는다.
  let snapshot: ExchangeLink[] | null = null;

  // 메서드가 아니라 클로저다. 호출부가 `const [, update] = useExchangeLinks()`처럼
  // 함수만 떼어 들고 다녀도 동작해야 한다(`this`에 기대면 그 순간 깨진다).
  const getSnapshot = () => {
    if (snapshot === null) snapshot = loadExchangeLinks(storage);
    return snapshot;
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot,
    getServerSnapshot: () => NO_LINKS,
    update: (change) => {
      snapshot = change(getSnapshot());
      saveExchangeLinks(snapshot, storage);
      for (const listener of listeners) listener();
    },
  };
}

/**
 * 브라우저에 남아 있는 거래소 연동 목록.
 *
 * 저장소는 React 밖의 시스템이라 `useSyncExternalStore`로 읽는다.
 * 마운트 후 `setState`로 채우는 방식은 하이드레이션 시점에 서버 결과와 다른 화면을 만들고,
 * 이 프로젝트의 lint 규칙(`react-hooks/set-state-in-effect`)도 그것을 막는다.
 * 서버 스냅샷을 빈 목록으로 고정해 두면 하이드레이션은 서버와 같은 화면에서 시작하고,
 * 그 직후 클라이언트 스냅샷으로 한 번만 갱신된다.
 */
export function useExchangeLinks(storage?: Storage | null) {
  const store = useMemo(() => createExchangeLinkStore(storage), [storage]);
  const links = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return [links, store.update] as const;
}
