import { describe, expect, it } from "vitest";

import { parseBackendOrigin } from "@/lib/api-mode";

// Slice 0: 순수 검증/정규화 함수의 경계 테스트. backendOrigin()에는 아직 배선되지 않는다(Slice 5).
describe("parseBackendOrigin", () => {
  it("빈/미설정/공백은 undefined (호출자가 fail-closed를 결정)", () => {
    expect(parseBackendOrigin(undefined)).toBeUndefined();
    expect(parseBackendOrigin("")).toBeUndefined();
    expect(parseBackendOrigin("   ")).toBeUndefined();
  });

  it("정상 http/https origin은 그대로 반환한다", () => {
    expect(parseBackendOrigin("http://localhost:3200")).toBe("http://localhost:3200");
    expect(parseBackendOrigin("https://api.example.com")).toBe("https://api.example.com");
    expect(parseBackendOrigin("  http://localhost:3200  ")).toBe("http://localhost:3200");
  });

  it("후행 슬래시 하나는 origin으로 정규화한다", () => {
    expect(parseBackendOrigin("http://localhost:3200/")).toBe("http://localhost:3200");
    expect(parseBackendOrigin("https://api.example.com:8443/")).toBe("https://api.example.com:8443");
  });

  it("http/https 외 스킴은 거부한다", () => {
    expect(() => parseBackendOrigin("ftp://host:3200")).toThrow(/http\/https/);
    expect(() => parseBackendOrigin("ws://host:3200")).toThrow(/http\/https/);
    expect(() => parseBackendOrigin("file:///etc/hosts")).toThrow(/http\/https/);
  });

  it("자격증명(user:pass)이 있으면 거부한다", () => {
    expect(() => parseBackendOrigin("http://user:pass@host:3200")).toThrow(/자격증명/);
    expect(() => parseBackendOrigin("http://user@host:3200")).toThrow(/자격증명/);
  });

  it("경로/쿼리/해시가 있으면 거부한다 (origin만 허용)", () => {
    expect(() => parseBackendOrigin("http://host:3200/api")).toThrow(/origin만/);
    expect(() => parseBackendOrigin("http://host:3200/api/auth")).toThrow(/origin만/);
    expect(() => parseBackendOrigin("http://host:3200?x=1")).toThrow(/origin만/);
    expect(() => parseBackendOrigin("http://host:3200#frag")).toThrow(/origin만/);
  });

  it("URL로 파싱 불가한 값은 거부한다", () => {
    expect(() => parseBackendOrigin("not a url")).toThrow(/유효한 URL/);
    expect(() => parseBackendOrigin("localhost:3200")).toThrow(/유효한 URL|http\/https/);
  });
});
