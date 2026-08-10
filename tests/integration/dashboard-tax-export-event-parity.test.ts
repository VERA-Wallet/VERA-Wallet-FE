import { describe, expect, it } from "vitest";

import { bootstrapBeSession } from "./support/bootstrap-be-session";

const FE = "http://localhost:3100";
// 이 스펙 전용 고정 키. BE mock identity는 모든 DID를 같은 user로 매핑하므로 지갑을 바꿔도 격리되지는 않는다.
const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f094538dc9e7b3b3e6eec5bc8b54e8f7f4f0b5d7" as const;

type EventItem = { event: { id: string; block_timestamp: string; asset_symbol?: string | null; symbol?: string | null; classification: string; user_override: { classification: string } | null }; version: number };

async function listEventIds(cookie: string): Promise<{ ids: string[]; timestamps: Map<string, string>; internalTransfers: Set<string>; versions: Map<string, number>; rawSymbols: Array<string | null> }> {
  const response = await fetch(`${FE}/api/events?limit=100`, { headers: { cookie } });
  expect(response.status).toBe(200);
  const body = await response.json() as { data: { items: EventItem[] } };
  const versions = new Map(body.data.items.map((item) => [item.event.id, item.version]));
  return {
    ids: body.data.items.map((item) => item.event.id),
    timestamps: new Map(body.data.items.map((item) => [item.event.id, item.event.block_timestamp])),
    internalTransfers: new Set(body.data.items.filter((item) => (item.event.user_override?.classification ?? item.event.classification) === "INTERNAL_TRANSFER").map((item) => item.event.id)),
    versions,
    // 프록시는 BE 원본을 그대로 통과시키므로 여기에는 canonical `asset_symbol`이 아니라 BE의 `symbol`이 온다.
    // 정규화는 FE 어댑터 경계(beNormalizedEventSchema)가 담당한다 — 그래서 두 키를 모두 본다.
    rawSymbols: body.data.items.map((item) => item.event.asset_symbol ?? item.event.symbol ?? null),
  };
}

describe("dashboard, export, and tax read the same BE events", () => {
  it("serves BE fixture events through the rewrite with canonical asset symbols", async () => {
    const cookie = await bootstrapBeSession(FE, PRIVATE_KEY);
    const { ids, rawSymbols } = await listEventIds(cookie);

    // BE mock fixture는 25건이다. 대시보드·내보내기·세금이 모두 이 집합을 봐야 한다.
    expect(ids.length).toBe(25);
    // BE가 심볼을 실제로 준다(하나라도 null이면 화면에 자산 이름이 빈다).
    expect(rawSymbols.filter((symbol) => symbol !== null)).toHaveLength(25);

    // 그 원본을 FE canonical 경계에 통과시키면 `asset_symbol`이 채워져야 한다.
    // 이게 깨지면 대시보드·내보내기의 자산 이름이 통째로 빈다.
    const { beNormalizedEventSchema } = await import("@/lib/schema/be-event-transport");
    const raw = await (await fetch(`${FE}/api/events?limit=100`, { headers: { cookie } })).json() as { data: { items: Array<{ event: unknown }> } };
    for (const item of raw.data.items) {
      expect(beNormalizedEventSchema.parse(item.event)).toMatchObject({ asset_verified: false });
      expect((beNormalizedEventSchema.parse(item.event) as { asset_symbol: string | null }).asset_symbol).not.toBeNull();
    }
  }, 120_000);

  it("feeds the FE tax engine from the same event ids the dashboard shows", async () => {
    const cookie = await bootstrapBeSession(FE, PRIVATE_KEY);
    const { ids, timestamps, internalTransfers, versions } = await listEventIds(cookie);
    const taxYear = new Date(await latestTimestamp(cookie)).getUTCFullYear();

    const estimate = await fetch(`${FE}/api/tax/estimate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ country: "US", taxYear, source: "wallet" }),
    });
    expect(estimate.status).toBe(200);
    const body = await estimate.json() as { data: { judgments: Array<{ eventId: string }>; excludedEventIds: string[]; period: { from: string; to: string } } };

    // 세금 판정에 등장하는 이벤트는 전부 대시보드가 보여준 집합 안에 있어야 한다.
    const dashboardIds = new Set(ids);
    const judgmentIds = new Set(body.data.judgments.map((row) => row.eventId));
    expect(judgmentIds.size).toBeGreaterThan(0);
    for (const id of judgmentIds) expect(dashboardIds.has(id)).toBe(true);
    // 과세기간 안 이벤트는 하나도 조용히 사라지면 안 된다. 셋 중 하나여야 한다:
    // (1) 판정에 나오거나(계산됨), (2) 제외 목록에 있거나(계산 불가 사유가 화면에 표시됨),
    // (3) 내부 이체(과세 대상이 아니라 판정도 제외도 아닌 것이 정상 — 실측으로 확인).
    const excludedIds = new Set(body.data.excludedEventIds);
    // 제외 목록에 대시보드에 없는 id가 섞이면 계산이 다른 우주의 이벤트를 봤다는 뜻이다.
    for (const id of excludedIds) expect(dashboardIds.has(id)).toBe(true);
    // 판정과 제외는 상호배타여야 한다. 겹치면 같은 거래가 계산되고 동시에 "계산 못 함"으로 보고된다.
    for (const id of judgmentIds) expect(excludedIds.has(id)).toBe(false);
    const accountedFor = new Set([...judgmentIds, ...excludedIds]);
    const inPeriod = ids.filter((id) => {
      const at = timestamps.get(id)!;
      return at >= body.data.period.from && at < body.data.period.to;
    });
    expect(inPeriod.length).toBeGreaterThan(0);
    for (const id of inPeriod) expect({ id, accounted: accountedFor.has(id) || internalTransfers.has(id) }).toMatchObject({ accounted: true });

    // 내보내기도 같은 집합을 봐야 한다. 여기서 갈라지면 사용자가 신고에 쓰는 파일만 다른 우주가 된다.
    // 내보내기는 브라우저에서 파일을 만들지만 그 입력은 이 목록 API이므로, 전량 수집 결과가 대시보드와 같은지 고정한다.
    const exportInput = await fetch(`${FE}/api/events?limit=100`, { headers: { cookie } });
    const exportBody = await exportInput.json() as { data: { items: EventItem[]; nextCursor: string | null } };
    expect(new Set(exportBody.data.items.map((item) => item.event.id))).toEqual(dashboardIds);
    // nextCursor가 남아 있으면 내보내기가 부분 파일을 만든다는 뜻이다.
    expect(exportBody.data.nextCursor).toBeNull();

    // 재분류를 하지 않았으므로 같은 id의 version이 흔들리면 스냅샷이 서로 다른 시점을 본 것이다.
    const recheck = await listEventIds(cookie);
    for (const [id, version] of versions) expect(recheck.versions.get(id)).toBe(version);
  }, 120_000);

  it("matches the US FIFO golden totals produced by the FE engine on the BE fixture", async () => {
    // 계산 결과가 조용히 바뀌면(룰셋·lot 매칭·기간 산정) 여기서 먼저 빨개진다.
    // golden은 이 테스트가 아니라 별도 생성 절차로 만들어 커밋했다 — 같은 구현으로 기대값을 만들지 않는다.
    const golden = (await import("@/tests/fixtures/be-us-golden.json")).default as {
      taxYear: number; eventCount: number;
      us: { totals: Record<string, string>; status: string; method: string };
      perCountry: Record<string, { judgments: number; excluded: number }>;
    };
    const cookie = await bootstrapBeSession(FE, PRIVATE_KEY);
    const { ids } = await listEventIds(cookie);
    expect(ids.length).toBe(golden.eventCount);

    const response = await fetch(`${FE}/api/tax/estimate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ country: "US", taxYear: golden.taxYear, source: "wallet" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { totals: Record<string, string>; status: string; method: string; judgments: unknown[] } };
    expect(body.data.totals).toEqual(golden.us.totals);
    expect(body.data.status).toBe(golden.us.status);
    expect(body.data.method).toBe(golden.us.method);
    expect(body.data.judgments.length).toBe(golden.perCountry.US.judgments);
  }, 120_000);

  it("covers every ruleset country with at least one in-period event", async () => {
    const cookie = await bootstrapBeSession(FE, PRIVATE_KEY);
    const taxYear = new Date(await latestTimestamp(cookie)).getUTCFullYear();
    // 비역년 과세기간(GB 4/6~, AU 7/1~)이 BE fixture 기간을 감싸는지 확인한다.
    // 12개 룰셋 전부를 본다. 일부만 보면 비역년 과세기간(GB 4/6, AU 7/1)이 픽스처 기간을 벗어난 것을 놓친다.
    const golden = (await import("@/tests/fixtures/be-us-golden.json")).default as { perCountry: Record<string, { judgments: number }> };
    for (const country of Object.keys(golden.perCountry)) {
      const response = await fetch(`${FE}/api/tax/estimate`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ country, taxYear, source: "wallet" }),
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { judgments: unknown[] } };
      expect({ country, judgments: body.data.judgments.length }).toMatchObject({ country });
      expect(body.data.judgments.length).toBeGreaterThan(0);
      // 국가별 판정 건수도 고정한다 — 기간 산정이 흔들리면 건수부터 달라진다.
      expect({ country, judgments: body.data.judgments.length }).toEqual({ country, judgments: golden.perCountry[country]!.judgments });
    }
  }, 180_000);
});

async function latestTimestamp(cookie: string): Promise<string> {
  const response = await fetch(`${FE}/api/events?limit=100`, { headers: { cookie } });
  const body = await response.json() as { data: { items: EventItem[] } };
  return body.data.items.reduce((max, item) => (item.event.block_timestamp > max ? item.event.block_timestamp : max), body.data.items[0]!.event.block_timestamp);
}
