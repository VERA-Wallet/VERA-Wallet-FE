import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

type ServerOptions = { port?: number; env?: Record<string, string> };
type StartedServer = { child: ChildProcess; port: number; output: string[] };

const BE_CWD = process.env.VERAWALLET_BACKEND_CWD ?? path.resolve(process.cwd(), "../verawallet-be");
// globalSetup과 테스트 파일은 서로 다른 워커일 수 있어 모듈 스코프 핸들을 공유할 수 없으므로 PID를 임시 파일에도 기록한다.
const BACKEND_PID_FILE = path.join(tmpdir(), "vw-integration-backend.pid");
const NEXT_PID_FILE = path.join(tmpdir(), "vw-integration-next.pid");
const OUTPUT_LIMIT = 300;
const startedServers = new Map<string, StartedServer>();

function appendOutput(lines: string[], chunk: Buffer) {
  lines.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
  if (lines.length > OUTPUT_LIMIT) lines.splice(0, lines.length - OUTPUT_LIMIT);
}

async function writePidFile(pidFile: string, pid: number, port: number) {
  // 다른 워커가 truncate와 write 사이에 부분 JSON을 읽지 않도록 임시 파일에 쓴 뒤 rename으로 원자 교체한다.
  const staging = `${pidFile}.${process.pid}.tmp`;
  await writeFile(staging, JSON.stringify({ pid, port }), "utf8");
  await rename(staging, pidFile);
}

/** 테스트 전용 노출: PID 파일 검증이 fail-closed인지 직접 단언하기 위해 필요하다. */
export async function readPidFile(pidFile: string): Promise<{ pid: number; port: number } | undefined> {
  let contents: string;
  try {
    contents = await readFile(pidFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const value: unknown = JSON.parse(contents);
  if (!value || typeof value !== "object") throw new Error(`Invalid PID file ${pidFile}.`);
  const { pid, port } = value as { pid?: unknown; port?: unknown };
  // process.kill(-pid)는 프로세스 그룹 브로드캐스트다. pid 0/1 같은 값이 들어오면 시스템 범위를 겨냥할 수 있어 fail-closed로 막는다.
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 1) throw new Error(`Invalid PID file ${pidFile}: unsafe pid ${String(pid)}.`);
  if (typeof port !== "number" || !Number.isSafeInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid PID file ${pidFile}: unsafe port ${String(port)}.`);
  return { pid, port };
}

async function removePidFile(pidFile: string) {
  await rm(pidFile, { force: true });
}

function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

async function waitForPortRelease(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await isPortOpen(port)) return;
    await delay(100);
  }
  throw new Error(`Server process remained on port ${port} after shutdown.`);
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return Promise.race([once(child, "exit").then(() => true), delay(timeoutMs).then(() => false)]);
}
async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await delay(100);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
      throw error;
    }
  }
  return false;
}

function terminateGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function stopServer(pidFile: string) {
  const started = startedServers.get(pidFile);
  const persisted = await readPidFile(pidFile);
  // PID 파일이 진실 소스다. globalSetup과 테스트 파일이 서로 다른 워커 컨텍스트일 수 있어,
  // 다른 컨텍스트가 서버를 재기동하면 이 컨텍스트의 메모리 핸들은 이미 죽은 옛 pid를 가리킨다.
  // 그때 메모리 핸들을 우선하면 죽은 pid에 신호를 보내고 살아 있는 프로세스가 포트를 쥔 채 남는다.
  const pid = persisted?.pid ?? started?.child.pid;
  const port = persisted?.port ?? started?.port;
  if (!pid || !port) return;
  // 메모리 핸들은 pid가 일치할 때만 exit 대기에 쓸 수 있다.
  const ownedChild = started && started.child.pid === pid ? started.child : undefined;

  // 손자 프로세스가 생기는 기동 방식(pnpm → nest 등)에서도 포트를 쥔 프로세스가 남지 않도록 그룹째 종료한다.
  terminateGroup(pid, "SIGTERM");
  const exited = ownedChild ? await waitForExit(ownedChild, 10_000) : await waitForProcessExit(pid, 10_000);
  if (!exited) {
    terminateGroup(pid, "SIGKILL");
    if (ownedChild) await waitForExit(ownedChild, 10_000);
    else await waitForProcessExit(pid, 10_000);
  }

  try {
    await waitForPortRelease(port, 10_000);
  } catch (error) {
    // 정리 실패 시 PID 파일을 지우면 포트를 쥔 프로세스를 종료할 유일한 교차 워커 제어 정보가 사라진다.
    // 후속 teardown이 재시도할 수 있도록 상태를 보존한 채로만 실패시킨다.
    throw new Error(`Could not release server process group ${pid} on port ${port}: ${(error as Error).message}`);
  }
  startedServers.delete(pidFile);
  await removePidFile(pidFile);
}

async function startServer(command: string, args: string[], cwd: string, port: number, env: Record<string, string>, pidFile: string, healthUrl: string, health: { field?: string; expected?: unknown }, outputLabel: string) {
  const existing = await readPidFile(pidFile);
  if (existing && await isPortOpen(existing.port)) throw new Error(`${outputLabel} is already running as process group ${existing.pid} on port ${existing.port}.`);
  if (existing) await removePidFile(pidFile);

  const output: string[] = [];
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: "pipe" });
  child.stdout?.on("data", (chunk: Buffer) => appendOutput(output, chunk));
  child.stderr?.on("data", (chunk: Buffer) => appendOutput(output, chunk));
  const server = { child, port, output };
  startedServers.set(pidFile, server);
  if (!child.pid) throw new Error(`Failed to start ${outputLabel}: no child PID was assigned.`);
  await writePidFile(pidFile, child.pid, port);

  try {
    await waitForHealth(healthUrl, { ...health, timeoutMs: 180_000 });
  } catch (error) {
    try {
      await stopServer(pidFile);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${outputLabel} did not become healthy and cleanup failed.\nLast output:\n${output.slice(-30).join("\n")}`,
      );
    }
    throw new Error(`${outputLabel} did not become healthy: ${(error as Error).message}\nLast output:\n${output.slice(-30).join("\n")}`);
  }
}

export async function waitForHealth(url: string, opts: { field?: string; expected?: unknown; timeoutMs: number }): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status === 200) {
        if (!opts.field) return;
        const body: unknown = await response.json();
        if (body && typeof body === "object" && (body as Record<string, unknown>)[opts.field] === opts.expected) return;
        lastError = `status 200 but ${opts.field} did not equal ${JSON.stringify(opts.expected)}`;
      } else lastError = `status ${response.status}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await delay(250);
  }
  throw new Error(`Timed out after ${opts.timeoutMs}ms waiting for ${url} (${lastError}).`);
}

/**
 * BE를 빌드한 뒤 `node dist/main.js`로 띄운다.
 *
 * `pnpm --filter @vera/backend dev`(nest start --watch)를 쓰지 않는 이유:
 * BE의 `apps/backend/tsconfig.json`이 `composite: true`인데 nest-cli는 `deleteOutDir: true`다.
 * 그래서 watch가 dist를 지운 뒤 tsc는 `tsconfig.build.tsbuildinfo`를 보고 "이미 최신"이라 판단해
 * 아무것도 방출하지 않고, nest는 존재하지 않는 dist/main을 실행해 즉시 죽는다("Found 0 errors" 직후 MODULE_NOT_FOUND).
 * 이건 BE 저장소 쪽 빌드 설정 문제이며 이 하네스는 BE 소스를 고치지 않는다 —
 * 대신 stale tsbuildinfo(gitignore된 빌드 산출물)를 지우고 직접 빌드해 우회한다.
 * 부수 효과로 watcher가 없어 기동이 2초대로 빨라지고 종료도 결정적이다.
 */
let backendBuild: Promise<void> | undefined;

/**
 * BE dist 빌드는 프로세스당 한 번만 한다.
 *
 * 스펙/파일마다 BE를 재기동하는데(인메모리 격리) 그때마다 `pnpm build`를 다시 돌리면
 * 여러 pnpm 프로세스가 store 락을 두고 서로 기다리다 lane 전체가 멈춘다.
 * 실행 중 BE 소스가 바뀌지 않으므로 첫 빌드 결과를 재사용하는 것이 안전하다.
 */
function buildBackendOnce(): Promise<void> {
  // 실패한 Promise를 캐시하면 일시적 빌드 실패 한 번이 이후 모든 재기동을 영구 실패로 만든다.
  // 캐시는 "성공한 빌드"만 의미해야 하므로 거절 시 비운다.
  backendBuild ??= buildBackend().catch((cause: unknown) => {
    backendBuild = undefined;
    throw cause;
  });
  return backendBuild;
}

async function buildBackend(): Promise<void> {
  const backendDir = path.join(BE_CWD, "apps", "backend");
  await rm(path.join(backendDir, "tsconfig.build.tsbuildinfo"), { force: true });
  for (const [command, args, cwd] of [
    ["pnpm", ["--filter", "@vera/interfaces", "build"], BE_CWD],
    ["pnpm", ["--filter", "@vera/tax-engine", "build"], BE_CWD],
    ["npx", ["tsc", "-p", "tsconfig.build.json"], backendDir],
  ] as const) {
    await runToCompletion(command, [...args], cwd);
  }
}

function runToCompletion(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: "pipe" });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} (cwd=${cwd}) exited with ${code}:\n${output.slice(-2000)}`));
    });
  });
}

export async function startBackend(opts: ServerOptions = {}): Promise<void> {
  const port = opts.port ?? 3200;
  // BE_CWD는 형제 verawallet-be를 전제하지만 VERAWALLET_BACKEND_CWD로 재정의할 수 있다.
  await buildBackendOnce();
  await startServer("node", ["dist/main.js"], path.join(BE_CWD, "apps", "backend"), port, {
    MOCK_MODE: "true",
    PORT: String(port),
    FRONTEND_ORIGIN: "http://localhost:3100",
    SIWE_TRUSTED_ORIGIN: "http://localhost:3100",
    JWT_SECRET: "local-development-secret-at-least-32-characters",
    ...opts.env,
  }, BACKEND_PID_FILE, `http://localhost:${port}/health`, { field: "mockMode", expected: true }, "Backend");
}

export async function stopBackend(): Promise<void> { await stopServer(BACKEND_PID_FILE); }

export async function startNextServer(opts: ServerOptions = {}): Promise<void> {
  const port = opts.port ?? 3100;
  await startServer("pnpm", ["exec", "next", "dev", "-p", String(port)], process.cwd(), port, opts.env ?? {}, NEXT_PID_FILE, `http://localhost:${port}/`, {}, "Next server");
}

export async function stopAll(): Promise<void> {
  await stopServer(NEXT_PID_FILE);
  await stopBackend();
}
