import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "./nativeClient";

type Listener = (arg: unknown) => void;

interface Msg {
  version: number;
  id: string;
  type: string;
  payload: unknown;
}

interface FakePort {
  posted: Msg[];
  messageListeners: Listener[];
  disconnectListeners: Listener[];
  onMessage: { addListener: (fn: Listener) => void };
  onDisconnect: { addListener: (fn: Listener) => void };
  postMessage: (msg: Msg) => void;
}

function makeContext() {
  const port: FakePort = {
    posted: [],
    messageListeners: [],
    disconnectListeners: [],
    onMessage: { addListener: (fn) => port.messageListeners.push(fn) },
    onDisconnect: { addListener: (fn) => port.disconnectListeners.push(fn) },
    postMessage: (msg) => port.posted.push(msg),
  };
  const chromeMock = {
    runtime: {
      connectNative: vi.fn(() => port),
      lastError: undefined as { message: string } | undefined,
      getManifest: () => ({ version: "0.1.0" }),
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
      setIcon: vi.fn(),
      setTitle: vi.fn(),
    },
  };
  return { port, chromeMock };
}

let ctx: ReturnType<typeof makeContext>;

function emitMessage(msg: Msg): void {
  ctx.port.messageListeners.forEach((fn) => fn(msg));
}

beforeEach(() => {
  client.__resetForTests();
  ctx = makeContext();
  (globalThis as unknown as { chrome: unknown }).chrome = ctx.chromeMock;
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe("nativeClient", () => {
  it("assigns unique ids to concurrent requests", async () => {
    const p1 = client.submit("https://example.com/a.zip", "popup");
    const p2 = client.submit("https://example.com/b.zip", "popup");

    const ids = ctx.port.posted.map((m) => m.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);

    for (const m of ctx.port.posted) {
      emitMessage({
        version: 1,
        id: m.id,
        type: "download_accepted",
        payload: { downloadId: "d" },
      });
    }

    await expect(p1).resolves.toMatchObject({ ok: true });
    await expect(p2).resolves.toMatchObject({ ok: true });
  });

  it("ignores a response that arrives after a timeout", async () => {
    vi.useFakeTimers();
    const p = client.submit("https://example.com/slow.zip", "popup");
    const posted = ctx.port.posted[0];

    await vi.advanceTimersByTimeAsync(client.REQUEST_TIMEOUT_MS + 1);
    await expect(p).resolves.toMatchObject({ ok: false, code: "TIMEOUT" });

    // A late download_accepted must be ignored, not throw or resolve anything.
    expect(() =>
      emitMessage({
        version: 1,
        id: posted.id,
        type: "download_accepted",
        payload: { downloadId: "late" },
      })
    ).not.toThrow();
  });

  it("fails pending requests when the host disconnects", async () => {
    const p = client.submit("https://example.com/a.zip", "popup");
    ctx.chromeMock.runtime.lastError = { message: "Native host has exited." };
    ctx.port.disconnectListeners.forEach((fn) => fn(undefined));

    await expect(p).resolves.toMatchObject({ ok: false, code: "APP_NOT_RUNNING" });
  });

  it("rejects invalid urls without contacting the host", async () => {
    const res = await client.submit("not a url", "popup");
    expect(res).toMatchObject({ ok: false, code: "INVALID_URL" });
    expect(ctx.port.posted).toHaveLength(0);
  });

  it("rejects unexpected response types", async () => {
    const p = client.submit("https://example.com/a.zip", "popup");
    const posted = ctx.port.posted[0];
    emitMessage({ version: 1, id: posted.id, type: "ready", payload: {} });

    await expect(p).resolves.toMatchObject({ ok: false, code: "INTERNAL" });
  });

  it("surfaces the server's structured error code", async () => {
    const p = client.submit("https://example.com/a.zip", "popup");
    const posted = ctx.port.posted[0];
    emitMessage({
      version: 1,
      id: posted.id,
      type: "error",
      payload: { code: "PROBE_FAILED", message: "nope" },
    });

    await expect(p).resolves.toMatchObject({ ok: false, code: "PROBE_FAILED" });
  });
});
