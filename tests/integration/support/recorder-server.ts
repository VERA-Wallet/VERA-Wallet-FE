import { once } from "node:events";
import { createServer } from "node:http";

export type RecordedRequest = {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string | undefined>;
};

const RECORDED_HEADER_NAMES = ["content-type", "accept", "cookie", "user-agent", "content-length"] as const;

export async function startRecorder(port = 3500): Promise<{
  recorded: RecordedRequest[];
  reset(): void;
  stop(): Promise<void>;
}> {
  const recorded: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const headers: Record<string, string | undefined> = {};
    for (const name of RECORDED_HEADER_NAMES) {
      const value = request.headers[name];
      headers[name] = Array.isArray(value) ? value.join(", ") : value;
    }

    recorded.push({
      method: request.method ?? "",
      path: requestUrl.pathname,
      query: requestUrl.search,
      headers,
    });

    const body = request.method === "GET" && requestUrl.pathname === "/__recorded" ? recorded : { sentinel: true };
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    recorded,
    reset: () => { recorded.length = 0; },
    stop: async () => {
      if (!server.listening) return;
      const closed = once(server, "close");
      server.close();
      await closed;
    },
  };
}
