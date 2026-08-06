/**
 * 메모리 `Storage`.
 *
 * 이 저장소를 주입해 테스트를 돌리는 이유는 편의가 아니다 — 실행 환경(Node 25 + jsdom)에서
 * `window.localStorage`가 껍데기 객체로 노출되는 일이 있어, 전역에 기대면 테스트가
 * 화면 로직이 아니라 러너 사정을 검증하게 된다. 컴포넌트는 저장소를 주입받는다.
 */
export function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}
