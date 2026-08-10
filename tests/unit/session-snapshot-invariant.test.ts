import { describe, expect, it } from "vitest";
import { isCompletedOnboarding, isDidVerified } from "@/lib/dal";
import type { SessionSnapshot } from "@/lib/ports/session-snapshot";

// @ts-expect-error BE 스냅샷은 JWT가 만료를 담당하므로 FE 만료 필드를 둘 수 없다.
const beWithExpiry: SessionSnapshot = { source: "be", didVerified: true, countryCode: "KR", walletAddress: null, chainId: null, didExpiresAt: 1 };
// @ts-expect-error mock 스냅샷은 DID와 wallet 만료 시각을 모두 가져야 한다.
const mockWithoutExpiry: SessionSnapshot = { source: "mock", didVerified: true, countryCode: "KR", walletAddress: null, chainId: null, didExpiresAt: 1 };
// @ts-expect-error anonymous 스냅샷에는 인증 claim이 없다.
const anonymousWithCountry: SessionSnapshot = { source: "anonymous", countryCode: "KR" };
void [beWithExpiry, mockWithoutExpiry, anonymousWithCountry];

describe("session snapshot invariants", () => {
  it("applies verification and completion rules to every snapshot variant including expiry boundaries", () => {
    const anonymous: SessionSnapshot = { source: "anonymous" };
    const be: SessionSnapshot = { source: "be", didVerified: true, countryCode: "KR", walletAddress: "0x123", chainId: 1 };
    const mock: SessionSnapshot = { source: "mock", didVerified: true, countryCode: "KR", walletAddress: "0x123", chainId: 1, didExpiresAt: 11, walletExpiresAt: 12 };

    expect(isDidVerified(anonymous, 10)).toBe(false);
    expect(isCompletedOnboarding(anonymous, 10)).toBe(false);
    expect(isDidVerified(be, 10)).toBe(true);
    expect(isCompletedOnboarding(be, 10)).toBe(true);
    expect(isDidVerified(mock, 10)).toBe(true);
    expect(isCompletedOnboarding(mock, 10)).toBe(true);
    expect(isDidVerified(mock, 11)).toBe(false);
    expect(isCompletedOnboarding(mock, 11)).toBe(false);
    expect(isCompletedOnboarding({ ...mock, didExpiresAt: 20, walletExpiresAt: 11 }, 11)).toBe(false);
  });
});
