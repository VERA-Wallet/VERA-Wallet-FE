import { describe, expect, it } from "vitest";
import { GET } from "@/app/opendid/addVcInfo/route";
import { publicDidTarget } from "@/lib/opendid/public-gateway";

describe("development credential WebView", () => {
  it("resumes native authorization without saving or reflecting user-provided claims", async () => {
    const response = GET(new Request("https://example.org/opendid/addVcInfo?did=did:omn:Example&vcSchemaId=verawallet-dev&userName=%3Cscript%3Eattack%3C/script%3E"));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(html).toContain("window.android.onCompletedAddVcUpload()");
    expect(html).not.toContain("attack");
    expect(html).not.toContain("did:omn:Example");
    expect(html).not.toContain("fetch(");
    expect(publicDidTarget("demo/api/save-user-info".split("/"), "POST", "localhost")).toBeNull();
  });
  it.each([
    "", "?did=did:omn:Example", "?did=did:omn:Example&vcSchemaId=report",
    "?did=%3Cscript%3E&vcSchemaId=verawallet-dev",
  ])("rejects invalid or unrelated issuance requests: %s", (query) => {
    expect(GET(new Request(`https://example.org/opendid/addVcInfo${query}`)).status).toBe(400);
  });
});
