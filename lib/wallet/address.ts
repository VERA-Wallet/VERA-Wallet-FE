import { checksumAddress } from "viem";

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export type ParsedWalletAddress =
  | { ok: true; address: string }
  | { ok: false; reason: "format" | "checksum" };

/**
 * 사용자가 붙여넣은 EVM 주소를 검사하고 EIP-55 체크섬 표기로 정규화한다.
 *
 * 대소문자가 섞인 주소는 체크섬을 담고 있으므로 그대로 검증한다 — 오타 한 글자를 여기서 잡지 않으면
 * 존재하지 않는 주소를 등록해 두고 "거래가 왜 안 뜨죠"로 돌아온다.
 * 반대로 전부 소문자(Etherscan 복사)나 전부 대문자는 체크섬 정보 자체가 없는 표기라 거절하지 않고 정규화만 한다.
 *
 * 클라이언트 입력 검증과 서버 등록 라우트가 같은 함수를 쓴다. 갈라지면 화면은 통과시키는데 서버가 400을 주거나,
 * 더 나쁘게는 서버만 통과시켜 정규화되지 않은 주소가 저장된다.
 */
export function parseWalletAddress(raw: string): ParsedWalletAddress {
  const trimmed = raw.trim();
  if (!HEX_ADDRESS.test(trimmed)) return { ok: false, reason: "format" };

  const body = trimmed.slice(2);
  const checksummed = checksumAddress(trimmed.toLowerCase() as `0x${string}`);
  const caseless = body === body.toLowerCase() || body === body.toUpperCase();
  if (!caseless && trimmed !== checksummed) return { ok: false, reason: "checksum" };

  return { ok: true, address: checksummed };
}

export type WalletAddressAssessment =
  | { kind: "empty" }
  /** 아직 42자가 안 됐고 형식 오류로 단정하기 이르다 — 타이핑 중에 붉은 글씨를 띄우지 않기 위한 상태. */
  | { kind: "typing" }
  | { kind: "ens" }
  | { kind: "format" }
  | { kind: "checksum" }
  | { kind: "duplicate"; address: string }
  | { kind: "valid"; address: string };

const EVM_ADDRESS_LENGTH = 42;

/**
 * 입력창 아래 인라인 피드백을 위한 판정. `parseWalletAddress`를 감싸서 "언제 말할지"만 덧붙인다.
 *
 * - 42자 미만이면 형식 오류를 아직 말하지 않는다(`typing`). 붙여넣기는 한 번에 들어오므로 실제 오류는 즉시 잡힌다.
 * - `.eth`로 끝나면 ENS 미지원을 따로 안내한다 — 형식 오류로 뭉개면 사용자는 무엇이 틀렸는지 모른다.
 * - 이미 등록된 주소는 오류가 아니라 정보다. 호출부가 톤을 다르게 그린다.
 */
export function assessWalletAddress(raw: string, boundAddress: string | null): WalletAddressAssessment {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "empty" };
  if (/\.eth$/i.test(trimmed)) return { kind: "ens" };
  const parsed = parseWalletAddress(trimmed);
  if (!parsed.ok) {
    if (parsed.reason === "checksum") return { kind: "checksum" };
    return trimmed.length < EVM_ADDRESS_LENGTH && trimmed.startsWith("0x") ? { kind: "typing" } : { kind: "format" };
  }
  if (boundAddress !== null && parsed.address.toLowerCase() === boundAddress.toLowerCase()) {
    return { kind: "duplicate", address: parsed.address };
  }
  return { kind: "valid", address: parsed.address };
}
