import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  disconnect: () => void;
  onMessage: { addListener: (fn: Listener) => void };
  onDisconnect: { addListener: (fn: Listener) => void };
  postMessage: (msg: Msg) => void;
}

type ChromeMock = ReturnType<typeof makeChrome>["chromeMock"];

function makeChrome() {
  const port: FakePort = {
    posted: [],
    messageListeners: [],
    disconnectListeners: [],
    disconnect: vi.fn(),
    onMessage: { addListener: (fn) => port.messageListeners.push(fn) },
    onDisconnect: { addListener: (fn) => port.disconnectListeners.push(fn) },
    postMessage: (msg) => port.posted.push(msg),
  };
  const chromeMock = {
    runtime: {
      connectNative: vi.fn(() => port),
      lastError: undefined as { message: string } | undefined,
      getManifest: () => ({ version: "0.1.0" }),
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
    },
    contextMenus: {
      create: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
      setIcon: vi.fn(),
      setTitle: vi.fn(),
    },
    storage: { local: { get: vi.fn(), set: vi.fn() } },
    tabs: {
      query: vi.fn(async () => []),
      create: vi.fn(),
      get: vi.fn(),
      remove: vi.fn(),
    },
    scripting: { executeScript: vi.fn() },
  };
  return { port, chromeMock };
}

let port: FakePort;
let chromeMock: ChromeMock;

beforeEach(() => {
  vi.resetModules();
  const made = makeChrome();
  port = made.port;
  chromeMock = made.chromeMock;
  (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
  vi.useRealTimers();
});

function onMessageListener() {
  return chromeMock.runtime.onMessage.addListener.mock.calls[0][0] as (
    msg: { type: string },
    sender: unknown,
    sendResponse: (res: unknown) => void
  ) => boolean;
}

describe("background", () => {
  it("updates the tooltip when a context-menu handoff fails", async () => {
    await import("./background");
    const onClicked = chromeMock.contextMenus.onClicked.addListener.mock
      .calls[0][0];
    onClicked(
      {
        menuItemId: "velox-download-link",
        linkUrl: "https://example.com/a.zip",
      },
      { url: "https://example.com" }
    );

    expect(port.posted[0].type).toBe("download_request");

    chromeMock.runtime.lastError = { message: "Native host has exited." };
    port.disconnectListeners.forEach((fn) => fn(undefined));

    await vi.waitFor(() =>
      expect(chromeMock.action.setTitle).toHaveBeenCalledWith({
        title:
          "Velox: request failed — open the Velox extension popup for help",
      })
    );
    expect(chromeMock.action.setBadgeText).toHaveBeenCalledWith({ text: "!" });
  });

  it("responds to a reconnect request with fresh status", async () => {
    await import("./background");
    const sendResponse = vi.fn();
    const keepOpen = onMessageListener()({ type: "velox:reconnect" }, {}, sendResponse);
    expect(keepOpen).toBe(true);

    const hello = port.posted[port.posted.length - 1];
    expect(hello.type).toBe("hello");
    port.messageListeners.forEach((fn) =>
      fn({ version: 1, id: hello.id, type: "ready", payload: {} })
    );

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ connected: true, errorCode: null })
      )
    );
  });

  it("reports status through getStatus", async () => {
    await import("./background");
    const sendResponse = vi.fn();
    expect(onMessageListener()({ type: "velox:getStatus" }, {}, sendResponse)).toBe(
      true
    );

    const hello = port.posted[port.posted.length - 1];
    expect(hello.type).toBe("hello");
    port.messageListeners.forEach((fn) =>
      fn({ version: 1, id: hello.id, type: "ready", payload: {} })
    );

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ connected: true })
      )
    );
  });
});
