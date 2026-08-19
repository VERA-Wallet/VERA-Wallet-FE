import { afterAll, beforeAll, expect, it } from "vitest";
import { startNextProduction, stopNextProduction, waitForHealth } from "./support/server-harness";
import { startRecorder, type RecordedRequest } from "./support/recorder-server";

const FE = "http://localhost:3300";
const RECORDER = "http://localhost:3500";

const routes: Array<{ name: string; method: "GET" | "POST" | "PATCH"; path: string; expectedPath?: string }> = [
  { name: "DID present", method: "POST", path: "/api/auth/did/present" },
  { name: "nonce", method: "POST", path: "/api/auth/nonce" },
  { name: "verify", method: "POST", path: "/api/auth/verify" },
  { name: "session", method: "GET", path: "/api/auth/session" },
  { name: "logout", method: "POST", path: "/api/auth/logout" },
  { name: "anchor", method: "GET", path: "/api/anchor-proof" },
  { name: "events", method: "GET", path: "/api/events" },
  { name: "events summary", method: "GET", path: "/api/events/summary" },
  { name: "event by id", method: "GET", path: "/api/events/e1" },
  { name: "event by id patch", method: "PATCH", path: "/api/events/e1" },
  { name: "query preservation", method: "GET", path: "/api/events?limit=5&cursor=abc" },
  // Next 기본 trailingSlash:false가 /api/anchor-proof/를 /api/anchor-proof로 308 정규화한 뒤 프록시한다 — recorder는 정규화된 경로를 관측한다.
  { name: "trailing slash", method: "GET", path: "/api/anchor-proof/", expectedPath: "/api/anchor-proof" },
];

type Recorder = Awaited<ReturnType<typeof startRecorder>>;
let recorder: Recorder;

beforeAll(async () => {
  recorder = await startRecorder(3500);
  // VERAWALLET_MOCK_MODE=""로 .env.local의 mock 강제(=true)를 pre-empt한다 — @next/env는 이미 present한 키를 덮지 않으므로
  // 프로덕션 서버가 ON(프록시) 모드로 뜨고, BACKEND_ORIGIN=recorder로 셰도 rewrite를 관측할 수 있다.
  await startNextProduction({ port: 3300, env: { VERAWALLET_BACKEND_ORIGIN: RECORDER, VERAWALLET_MOCK_MODE: "" } });
  await waitForHealth(`${FE}/`, { timeoutMs: 240_000 });
}, 240_000);

afterAll(async () => {
  try {
    await stopNextProduction();
  } finally {
    await recorder.stop();
  }
}, 240_000);

async function readRecorded(): Promise<RecordedRequest[]> {
  const response = await fetch(`${RECORDER}/__recorded`);
  expect(response.status).toBe(200);
  return await response.json() as RecordedRequest[];
}

it.each(routes)("rewrites $name $method $path to the recorder", async ({ method, path, expectedPath }) => {
  recorder.reset();
  const requested = new URL(path, FE);
  const response = await fetch(requested, { method });

  expect(response.headers.get("x-verawallet-fe-rewrite")).toBeTruthy();
  const recorded = await readRecorded();
  expect(recorded.some((entry) => (
    entry.method === method
    && entry.path === (expectedPath ?? requested.pathname)
    && entry.query === requested.search
  ))).toBe(true);
});

it("does not proxy FE-owned routes", async () => {
  recorder.reset();
  const path = "/api/tax/rulesets";
  const response = await fetch(`${FE}${path}`);

  expect(response.headers.get("x-verawallet-fe-rewrite")).toBeNull();
  const recorded = await readRecorded();
  expect(recorded.some((entry) => entry.path === path)).toBe(false);
});
