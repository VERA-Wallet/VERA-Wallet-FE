import { afterEach, expect, it, vi } from "vitest";
import { closeCxLogin, openCxLogin } from "@/lib/omnione/oacx";
afterEach(() => { closeCxLogin(); delete window.OACX; vi.unstubAllEnvs(); });
function configure() {
  vi.stubEnv("NEXT_PUBLIC_OMNIONE_CX_MOCK", "false");
  vi.stubEnv("NEXT_PUBLIC_OMNIONE_CX_AUTH_URL", "https://cx.example/ent/esign");
}
it("cancels a pending SDK call immediately and ignores its late callback after retry", async () => {
  configure();
  const callbacks: Array<(result: string) => void> = [];
  window.OACX = { LOAD_MODULE: vi.fn((_url, _options, callback) => callbacks.push(callback)) };
  const first = openCxLogin();
  const rejected = expect(first).rejects.toThrow("취소");
  await Promise.resolve();
  closeCxLogin();
  await rejected;
  const next = openCxLogin();
  await Promise.resolve();
  callbacks[0](JSON.stringify({ token: "old" }));
  callbacks[1](JSON.stringify({ token: "new" }));
  await expect(next).resolves.toBe("new");
});
it("removes the transparent frame and prevents cancelled script loading from opening another modal", async () => {
  configure();
  const pending = openCxLogin();
  const rejected = expect(pending).rejects.toThrow("취소");
  const frame = document.querySelector<HTMLIFrameElement>("#oacx-overlay-frame")!;
  const doc = frame.contentDocument!;
  const script = doc.querySelector("script")!;
  expect(frame.style.zIndex).toBe("2147483646");
  closeCxLogin();
  script.dispatchEvent(new Event("load"));
  await rejected;
  await Promise.resolve();
  expect(document.querySelector("#oacx-overlay-frame")).toBeNull();
  expect(doc.querySelectorAll("script")).toHaveLength(1);
});
