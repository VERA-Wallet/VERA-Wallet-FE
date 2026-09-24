import { publicDidTarget } from "@/lib/opendid/public-gateway";

export const runtime = "nodejs";
const MAX_BODY = 2 * 1024 * 1024;

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const host = process.env.OPENDID_PUBLIC_UPSTREAM_HOST;
  if (!host) return new Response(null, { status: 503 });
  const { path } = await context.params;
  const target = publicDidTarget(path, request.method, host);
  if (!target) return new Response(null, { status: 404 });
  target.search = new URL(request.url).search;
  let body: Uint8Array | undefined;
  if (request.method === "POST") {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return new Response(null, { status: 415 });
    if (Number(request.headers.get("content-length")) > MAX_BODY) return new Response(null, { status: 413 });
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); return new Response(null, { status: 413 }); }
      chunks.push(next.value);
    }
    body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  }
  const startedAt = performance.now();
  try {
    const response = await fetch(target, {
      method: request.method, body: body as BodyInit | undefined,
      // Never forward web cookies, Authorization or the internal issuer service key.
      headers: { "accept": "application/json", "content-type": "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(35_000),
    });
    const duration = performance.now() - startedAt;
    if (duration >= 1000 || process.env.PERF_TIMING === "true") console.info(JSON.stringify({ event: "did_proxy_timing", service: path[0], method: request.method, status: response.status, durationMs: Math.round(duration) }));
    const headers = { "Server-Timing": `did_upstream_headers;dur=${duration.toFixed(1)}`, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    return new Response(response.body, { status: response.status, headers });
  } catch {
    const duration = performance.now() - startedAt;
    console.info(JSON.stringify({ event: "did_proxy_timing", service: path[0], method: request.method, status: 502, durationMs: Math.round(duration) }));
    return Response.json({ code: "did_upstream_unavailable" }, { status: 502, headers: { "Server-Timing": `did_upstream_headers;dur=${duration.toFixed(1)}` } });
  }
}
export const GET = forward;
export const POST = forward;
