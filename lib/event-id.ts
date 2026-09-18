import { chainLabel, shortHash } from "@/lib/format";

/**
 * 이벤트 id를 한 줄에 들어갈 길이로 줄인다.
 *
 * id는 `42161:0xfb49…3a:log:199`(체인:트랜잭션:로그) 꼴이라 100자가 넘고, 16진 해시에는
 * 줄바꿈 기회가 없어 그대로 두면 카드 밖으로 삐져나간다. 체인은 이름으로, 해시는 앞뒤만,
 * 로그 번호는 `#199`로 접는다. 원문은 호출부가 title 속성으로 남긴다.
 *
 * 꼴이 다른 id(브릿지 합성 키 등)도 오므로 못 알아보면 가운데를 줄이는 것으로 물러난다 —
 * 형식을 단정하고 잘못 쪼개면 다른 이벤트를 가리키는 문자열이 만들어진다.
 *
 * `lib/format.ts`가 아니라 여기 있는 이유: 그쪽은 금액 포매터라 Number 변환이 한 자리도
 * 없어야 한다는 계약을 테스트로 못 박아 두었다(정밀도). 체인 id는 작은 정수라 Number가
 * 안전하지만, 그 계약에 예외를 내면 다음 사람이 금액에도 같은 예외를 낸다.
 */
export function shortEventId(id: string): string {
  const parsed = /^(\d+):(0x[0-9a-fA-F]{10,}):(.+)$/.exec(id);
  if (!parsed) return id.length > 24 ? `${id.slice(0, 14)}…${id.slice(-6)}` : id;
  const [, chainId, hash, tail] = parsed;
  const logIndex = /^log:(\d+)$/.exec(tail);
  return `${chainLabel(Number(chainId))} ${shortHash(hash)} ${logIndex ? `#${logIndex[1]}` : tail}`;
}
