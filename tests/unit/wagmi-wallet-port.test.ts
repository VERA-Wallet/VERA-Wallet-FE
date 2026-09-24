import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  connect: vi.fn(), getAccount: vi.fn(), signMessage: vi.fn(), watchAccount: vi.fn(),
  injected: { id: "injected", uid: "browser", getProvider: vi.fn() },
  metamask: { id: "metaMaskSDK", uid: "mobile", getProvider: vi.fn() },
}));
vi.mock("wagmi/actions", () => mocks);
vi.mock("@/lib/wallet/wagmi-config", () => ({ wagmiConfig: { connectors: [mocks.injected, mocks.metamask] } }));
import { wagmiWalletPort } from "@/lib/wallet/wagmi-wallet-port";
const address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
beforeEach(() => { vi.resetAllMocks(); mocks.getAccount.mockReturnValue({ isConnected: false }); mocks.connect.mockResolvedValue({ accounts: [address], chainId: 8453 }); });
describe("wallet connector selection", () => {
  it("uses the mobile SDK without checking for an injected provider", async () => {
    expect(await wagmiWalletPort.connect("metamask")).toEqual({ address, chainId: 8453 });
    expect(mocks.connect.mock.calls[0][1].connector).toBe(mocks.metamask);
    expect(mocks.injected.getProvider).not.toHaveBeenCalled();
  });
  it("retains browser wallet selection and fails clearly without a provider", async () => {
    await expect(wagmiWalletPort.connect("browser")).rejects.toThrow("모바일에서는 MetaMask");
    expect(mocks.connect).not.toHaveBeenCalled();
    mocks.injected.getProvider.mockResolvedValue({});
    await wagmiWalletPort.connect("browser");
    expect(mocks.connect.mock.calls[0][1].connector).toBe(mocks.injected);
  });
  it("reuses a restored mobile connection without requesting a second pairing", async () => {
    mocks.getAccount.mockReturnValue({ isConnected: true, address, chainId: 8453, connector: mocks.metamask });
    expect(await wagmiWalletPort.connect("metamask")).toEqual({ address, chainId: 8453 });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
