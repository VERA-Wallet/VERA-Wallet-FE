import { writeFileSync } from "node:fs";
import { keccak256 } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import digest from "@/tests/fixtures/report-file-digest.json";
import { EVIDENCE_FIXTURE_ESTIMATE } from "@/tests/fixtures/evidence-estimate";
import { REPORT_FIXTURE_EVENTS } from "@/tests/fixtures/report-events";
import { buildReportFile, hashReportFile } from "@/lib/export/report-hash";

/** digest를 의도적으로 갱신할 때만: `UPDATE_REPORT_FILE_DIGEST=1 pnpm test report-file-hash`. */
const DIGEST_PATH = "tests/fixtures/report-file-digest.json";

describe("리포트 파일 해시", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hashReportFile은 바이트의 keccak256을 32바이트 hex로 낸다", () => {
    const bytes = new TextEncoder().encode("hello");
    const result = hashReportFile(bytes);
    expect(result.algorithm).toBe("keccak256");
    expect(result.hash).toBe(keccak256(bytes));
    expect(result.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("CSV 바이트는 BOM(EF BB BF)으로 시작한다", () => {
    const file = buildReportFile("csv", REPORT_FIXTURE_EVENTS, EVIDENCE_FIXTURE_ESTIMATE);
    expect([...file.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("CSV와 XLSX는 같은 입력에서도 서로 다른 해시를 낸다", () => {
    const csv = buildReportFile("csv", REPORT_FIXTURE_EVENTS, EVIDENCE_FIXTURE_ESTIMATE);
    const xlsx = buildReportFile("xlsx", REPORT_FIXTURE_EVENTS, EVIDENCE_FIXTURE_ESTIMATE);
    expect(csv.hash).not.toBe(xlsx.hash);
  });

  it("estimate 금액 한 자리만 달라져도 두 종류 모두 해시가 달라진다", () => {
    const [first, ...rest] = EVIDENCE_FIXTURE_ESTIMATE.judgments;
    const tampered = { ...EVIDENCE_FIXTURE_ESTIMATE, judgments: [{ ...first, amount: "12000001" }, ...rest] };

    const csv = buildReportFile("csv", REPORT_FIXTURE_EVENTS, EVIDENCE_FIXTURE_ESTIMATE);
    const csvTampered = buildReportFile("csv", REPORT_FIXTURE_EVENTS, tampered);
    expect(csvTampered.hash).not.toBe(csv.hash);

    const xlsx = buildReportFile("xlsx", REPORT_FIXTURE_EVENTS, EVIDENCE_FIXTURE_ESTIMATE);
    const xlsxTampered = buildReportFile("xlsx", REPORT_FIXTURE_EVENTS, tampered);
    expect(xlsxTampered.hash).not.toBe(xlsx.hash);
  });

  it("estimate가 null이어도(빈 지갑·계산 실패) 두 종류 다 만들어지고 해시가 나온다", () => {
    const csv = buildReportFile("csv", REPORT_FIXTURE_EVENTS, null);
    const xlsx = buildReportFile("xlsx", REPORT_FIXTURE_EVENTS, null);
    expect(csv.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(xlsx.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(csv.bytes.byteLength).toBeGreaterThan(0);
    expect(xlsx.bytes.byteLength).toBeGreaterThan(0);
  });

  it("같은 프로세스 안에서 두 번 만들어도(호출 시각이 달라도) 같은 바이트를 낸다", () => {
    vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));
    const first = buildReportFile("xlsx", REPORT_FIXTURE_EVENTS, EVIDENCE_FIXTURE_ESTIMATE);

    vi.setSystemTime(new Date("2027-01-02T00:00:00.000Z"));
    const second = buildReportFile("xlsx", REPORT_FIXTURE_EVENTS, EVIDENCE_FIXTURE_ESTIMATE);

    expect(second.hash).toBe(first.hash);
    expect(second.bytes.byteLength).toBe(first.bytes.byteLength);
  });

  it("체크인된 digest와 일치한다 — 드리프트는 여기서 먼저 잡힌다", () => {
    const csv = buildReportFile("csv", REPORT_FIXTURE_EVENTS, EVIDENCE_FIXTURE_ESTIMATE);
    const xlsx = buildReportFile("xlsx", REPORT_FIXTURE_EVENTS, EVIDENCE_FIXTURE_ESTIMATE);

    if (process.env.UPDATE_REPORT_FILE_DIGEST) {
      writeFileSync(
        DIGEST_PATH,
        `${JSON.stringify(
          {
            note: digest.note,
            fixture: digest.fixture,
            csv: { byteLength: csv.bytes.byteLength, hash: csv.hash },
            xlsx: { byteLength: xlsx.bytes.byteLength, hash: xlsx.hash },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      // 갱신 실행에서 비교까지 하면, 방금 쓴 값이 아니라 import 시점에 읽힌 옛 fixture와 겨뤄
      // "갱신했는데 실패하는" 실행이 된다. 갱신은 갱신만 한다 — 검증은 다음 평범한 실행의 몫이다.
      return;
    }

    expect({ byteLength: csv.bytes.byteLength, hash: csv.hash }).toEqual(digest.csv);
    expect({ byteLength: xlsx.bytes.byteLength, hash: xlsx.hash }).toEqual(digest.xlsx);
  });
});
