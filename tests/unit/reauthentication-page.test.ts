import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), identity: vi.fn(), redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/dal", () => ({ requireDidSession: mocks.session }));
vi.mock("@/lib/api-mode", () => ({ identityMode: mocks.identity }));
vi.mock("@/components/did/did-login-flow", () => ({ DidLoginFlow: () => null }));
import VerifyIdentityPage from "@/app/settings/verify-identity/page";
beforeEach(() => { vi.clearAllMocks(); mocks.identity.mockResolvedValue({ provider: "omnione_cx", provenance: "live" }); });
describe("credential wallet reauthentication entry", () => {
  it("keeps signed-in users on the authentication screen and preserves their country", async () => {
    mocks.session.mockResolvedValue({ countryCode: "US" });
    const page = await VerifyIdentityPage();
    expect(mocks.redirect).not.toHaveBeenCalled();
    const flow = page.props.children[3];
    expect(flow.props).toMatchObject({ provider: "omnione_cx", initialCountry: "US", reauthentication: true });
  });
  it("requires a login session", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(VerifyIdentityPage()).rejects.toThrow("redirect:/login");
  });
  it("does not use a mock or Open DID authentication to satisfy a CX-only freshness requirement", async () => {
    mocks.session.mockResolvedValue({ countryCode: "KR" });
    mocks.identity.mockResolvedValue({ provider: "opendid", provenance: "live" });
    const page = await VerifyIdentityPage();
    expect(page.props.children[3].props.role).toBe("alert");
  });
});
