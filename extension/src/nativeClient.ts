import { ErrorCode, MessageType, VeloxError } from "./types";
import {
  ASSIST_CHUNK_BYTES,
  HANDSHAKE_TIMEOUT_MS,
  MAX_UNACKED_BYTES,
  NATIVE_HOST_NAME,
  PROTOCOL_VERSION,
  RECONNECT_COOLDOWN_MS,
  REQUEST_TIMEOUT_MS,
} from "./constants";
import type {
  AssistRequestPayload,
  ChunkAckPayload,
  DownloadAcceptedPayload,
  DownloadRequestPayload,
  Envelope,
  ErrorPayload,
  HelloPayload,
  StatusResponse,
  SubmitResult,
} from "./types";

/** Stable per-service-worker identity, reported to Velox in `hello`. */
const CLIENT_ID = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2);
  }
})();

/** Best-effort browser family label for the UI. */
function detectBrowser(): string {
  try {
    const nav = navigator as Navigator & { brave?: unknown };
    const ua = navigator.userAgent;
    if (nav.brave) return "Brave";
    if (/Edg\//.test(ua)) return "Edge";
    if (/OPR\//.test(ua)) return "Opera";
    return "Chrome";
  } catch {
    return "Browser";
  }
}

const BROWSER = detectBrowser();

let port: chrome.runtime.Port | null = null;
let connected = false;
/** True only after the app has acknowledged our `hello` on the current port. */
let handshaken = false;
let handshaking: Promise<void> | null = null;
let lastError: string | null = null;
let lastErrorCode: ErrorCode | null = null;
let disconnectedAt = 0;
let idSeq = 0;

interface Pending {
  resolve: (env: Envelope) => void;
  reject: (err: VeloxError) => void;
  timer: ReturnType<typeof setTimeout>;
  expect?: string;
}

interface SendOptions {
  timeoutMs?: number;
  expect?: string;
  force?: boolean;
}

const pending = new Map<string, Pending>();
let assistBridge: ((req: AssistRequestPayload) => void) | null = null;
let ackBridge: ((ack: ChunkAckPayload) => void) | null = null;
let cancelBridge: ((downloadId: string) => void) | null = null;

function newId(): string {
  idSeq += 1;
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `req-${rand}-${idSeq.toString(36)}`;
}

function envelope(id: string, type: string, payload: unknown): Envelope {
  return { version: PROTOCOL_VERSION, id, type, payload };
}

function rejectAllPending(err: VeloxError): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  pending.clear();
}

function classify(raw: string): VeloxError {
  const notFound = /not found|not registered|not installed|cannot connect/i.test(raw);
  return new VeloxError(
    notFound ? ErrorCode.HOST_NOT_FOUND : ErrorCode.APP_NOT_RUNNING,
    notFound ? "Velox browser host is not installed or registered." : "Velox is not running."
  );
}

function classifyDisconnect(): VeloxError {
  return classify(chrome.runtime.lastError?.message ?? "native host disconnected");
}

function ensurePort(force = false): chrome.runtime.Port {
  if (port) return port;

  if (!force && disconnectedAt && Date.now() - disconnectedAt < RECONNECT_COOLDOWN_MS) {
    throw new VeloxError(ErrorCode.APP_NOT_RUNNING, "Velox is not running.");
  }

  handshaken = false;
  const next = chrome.runtime.connectNative(NATIVE_HOST_NAME);

  next.onMessage.addListener((raw: unknown) => {
    const msg = raw as Envelope;
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

    const p = pending.get(msg.id);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(msg.id);
      if (msg.type === MessageType.ERROR || msg.type === MessageType.DOWNLOAD_REJECTED) {
        const err = (msg.payload ?? {}) as ErrorPayload;
        p.reject(new VeloxError((err.code as ErrorCode) || ErrorCode.REJECTED, err.message || "Request rejected"));
      } else if (p.expect && msg.type !== p.expect) {
        p.reject(new VeloxError(ErrorCode.INTERNAL, `Unexpected response: ${msg.type}`));
      } else {
        p.resolve(msg);
      }
      return;
    }

    // Unsolicited / late responses (e.g. arriving after a timeout) are ignored.
    if (msg.type === MessageType.PING) {
      try {
        next.postMessage(envelope(msg.id, MessageType.PONG, { clientId: CLIENT_ID }));
        chrome.storage.local.set({ lastPing: Date.now() });
      } catch {
        // ignore
      }
      return;
    }
    if (msg.type === MessageType.ASSIST_REQUEST) {
      const req = (msg.payload ?? {}) as AssistRequestPayload;
      // Prefer a page-context fetch (satisfies Cloudflare challenges); fall
      // back to a service-worker fetch if no bridge is registered.
      if (assistBridge) assistBridge(req);
      else void streamAssist(next, req);
      return;
    }
    if (msg.type === MessageType.CHUNK_ACK) {
      const ack = (msg.payload ?? {}) as ChunkAckPayload;
      // Release the SW-fetch window AND resolve a page-path chunk waiter.
      onChunkAck(ack);
      if (ackBridge) ackBridge(ack);
      return;
    }
    if (msg.type === MessageType.CANCEL_DOWNLOAD) {
      const p = (msg.payload ?? {}) as { downloadId?: string };
      if (cancelBridge && p.downloadId) cancelBridge(p.downloadId);
      return;
    }
    if (msg.type === MessageType.READY) {
      connected = true;
      lastError = null;
      lastErrorCode = null;
    } else if (msg.type === MessageType.ERROR) {
      const payload = (msg.payload ?? {}) as ErrorPayload;
      lastError = payload.message ?? "unknown error";
      lastErrorCode = (payload.code as ErrorCode) || ErrorCode.INTERNAL;
    }
  });

  next.onDisconnect.addListener(() => {
    // Ignore a stale port's disconnect after a reconnect replaced it.
    if (port !== next) return;
    const err = classifyDisconnect();
    connected = false;
    handshaken = false;
    lastError = err.message;
    lastErrorCode = err.code;
    disconnectedAt = Date.now();
    port = null;
    rejectAllPending(err);
  });

  port = next;
  return next;
}

function sendRequest(
  type: string,
  payload: unknown,
  { timeoutMs = REQUEST_TIMEOUT_MS, expect, force }: SendOptions = {}
): Promise<Envelope> {
  return new Promise((resolve, reject) => {
    let target: chrome.runtime.Port;
    try {
      target = ensurePort(force);
    } catch (e) {
      reject(e instanceof VeloxError ? e : classify(e instanceof Error ? e.message : String(e)));
      return;
    }

    const id = newId();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new VeloxError(ErrorCode.TIMEOUT, `No response to ${type} within ${timeoutMs}ms`));
    }, timeoutMs);

    pending.set(id, { resolve, reject, timer, expect });

    try {
      target.postMessage(envelope(id, type, payload));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(new VeloxError(ErrorCode.PORT_DISCONNECTED, e instanceof Error ? e.message : String(e)));
    }
  });
}

export function handshake(force = false): Promise<void> {
  if (handshaken) return Promise.resolve();
  if (handshaking) return handshaking;
  if (!force && disconnectedAt && Date.now() - disconnectedAt < RECONNECT_COOLDOWN_MS) {
    return Promise.resolve();
  }
  const hello: HelloPayload = {
    extVersion: chrome.runtime.getManifest().version,
    clientId: CLIENT_ID,
    browser: BROWSER,
  };
  const p = sendRequest(MessageType.HELLO, hello, {
    timeoutMs: HANDSHAKE_TIMEOUT_MS,
    expect: MessageType.READY,
    force,
  })
    .then(
      () => {
        handshaken = true;
        connected = true;
        lastError = null;
        lastErrorCode = null;
      },
      (e) => {
        // Surface handshake failures so the popup can offer a next step.
        const err = e instanceof VeloxError ? e : new VeloxError(ErrorCode.INTERNAL, String(e));
        handshaken = false;
        connected = false;
        lastError = err.message;
        lastErrorCode = err.code;
      }
    )
    .finally(() => {
      handshaking = null;
    });
  handshaking = p;
  return p;
}

/**
 * Force a fresh connection attempt, bypassing the reconnect cooldown, and
 * return the resulting status. Used by the popup's Reconnect action.
 */
export async function reconnect(): Promise<StatusResponse> {
  disconnectedAt = 0;
  handshaken = false;
  handshaking = null;
  if (port) {
    try {
      port.disconnect();
    } catch {
      // already closed
    }
    port = null;
  }
  connected = false;
  await handshake(true);
  return status();
}

/**
 * Current status, first attempting a handshake when disconnected. Used when the
 * popup opens so it can distinguish "app not installed" from "app closed".
 */
export async function refreshStatus(): Promise<StatusResponse> {
  if (!handshaken) {
    await handshake();
  }
  return status();
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "ftp:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export async function submit(
  url: string,
  source: string,
  context: Partial<DownloadRequestPayload> = {}
): Promise<SubmitResult> {
  if (!isValidUrl(url)) {
    return { ok: false, code: ErrorCode.INVALID_URL, error: "That doesn't look like a downloadable URL." };
  }

  try {
    // Identify this connection before the download so the app can register the
    // browser and route browser assistance back to it. Hello is posted first and
    // the native channel preserves order, so no round-trip is needed here.
    if (!handshaken) void handshake();
    const payload: DownloadRequestPayload = { url, source, ...context };
    const res = await sendRequest(MessageType.DOWNLOAD_REQUEST, payload, {
      expect: MessageType.DOWNLOAD_ACCEPTED,
    });
    const accepted = (res.payload ?? {}) as DownloadAcceptedPayload;
    connected = true;
    lastError = null;
    lastErrorCode = null;
    return { ok: true, downloadId: accepted.downloadId };
  } catch (e) {
    const err = e instanceof VeloxError ? e : new VeloxError(ErrorCode.INTERNAL, String(e));
    lastError = err.message;
    lastErrorCode = err.code;
    return { ok: false, code: err.code, error: err.message };
  }
}

export function status(): StatusResponse {
  return { connected, lastError, errorCode: lastErrorCode, clientId: CLIENT_ID };
}

/** Post an arbitrary protocol message to the app over the native port. */
export function postNative(type: string, payload: unknown): boolean {
  if (!port) return false;
  try {
    port.postMessage(envelope(newId(), type, payload));
    return true;
  } catch {
    return false;
  }
}

/** Register the handler invoked when the app requests browser assistance. */
export function setAssistBridge(fn: (req: AssistRequestPayload) => void): void {
  assistBridge = fn;
}

/** Register the handler invoked for chunk acknowledgements (page path). */
export function setAckBridge(fn: (ack: ChunkAckPayload) => void): void {
  ackBridge = fn;
}

/** Register the handler invoked when the app cancels a download. */
export function setCancelBridge(fn: (downloadId: string) => void): void {
  cancelBridge = fn;
}

// --- Browser-assisted streaming (M3) -----------------------------------------

interface Transfer {
  unacked: number;
  sizes: Map<number, number>;
  waiters: Array<() => void>;
}

const transfers = new Map<string, Transfer>();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function waitForRoom(t: Transfer): Promise<void> {
  if (t.unacked <= MAX_UNACKED_BYTES) return Promise.resolve();
  return new Promise((resolve) => t.waiters.push(resolve));
}

function onChunkAck(ack: ChunkAckPayload): void {
  const t = transfers.get(ack.transferId);
  if (!t) return;
  const len = t.sizes.get(ack.seq) ?? 0;
  t.sizes.delete(ack.seq);
  t.unacked = Math.max(0, t.unacked - len);
  if (t.unacked <= MAX_UNACKED_BYTES / 2) {
    t.waiters.splice(0).forEach((resolve) => resolve());
  }
}

async function streamAssist(port: chrome.runtime.Port, req: AssistRequestPayload): Promise<void> {
  const downloadId = req.downloadId;
  const transferId = `t-${downloadId}-${Date.now().toString(36)}`;
  const post = (type: string, payload: unknown) => {
    try {
      port.postMessage(envelope(newId(), type, payload));
    } catch {
      // port closed
    }
  };

  post(MessageType.ASSIST_STARTED, { downloadId, transferId });

  let res: Response;
  try {
    res = await fetch(req.url, { credentials: "include", redirect: "follow" });
  } catch (e) {
    post(MessageType.ASSIST_FAILED, {
      downloadId,
      transferId,
      code: "ASSIST_FETCH_FAILED",
      message: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  console.log("[velox assist] fetch result", {
    url: req.url,
    status: res.status,
    ok: res.ok,
    contentType: res.headers.get("content-type"),
    cfMitigated: res.headers.get("cf-mitigated"),
  });

  if (!res.ok || !res.body) {
    post(MessageType.ASSIST_FAILED, {
      downloadId,
      transferId,
      code: "ASSIST_FETCH_FAILED",
      message: `HTTP ${res.status}`,
    });
    return;
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (contentType.startsWith("text/html")) {
    post(MessageType.ASSIST_FAILED, {
      downloadId,
      transferId,
      code: "ASSIST_CHALLENGE",
      message: "Server returned an HTML page (possible bot check).",
    });
    return;
  }

  const transfer: Transfer = { unacked: 0, sizes: new Map(), waiters: [] };
  transfers.set(transferId, transfer);

  const reader = res.body.getReader();
  let seq = 0;
  let offset = 0;
  let buffer = new Uint8Array(0);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = concatBytes(buffer, value);
      while (buffer.length >= ASSIST_CHUNK_BYTES) {
        const part = buffer.subarray(0, ASSIST_CHUNK_BYTES);
        post(MessageType.CHUNK, {
          downloadId,
          transferId,
          seq,
          offset,
          data: bytesToBase64(part),
        });
        transfer.sizes.set(seq, part.length);
        transfer.unacked += part.length;
        offset += part.length;
        seq += 1;
        buffer = buffer.subarray(ASSIST_CHUNK_BYTES);
        await waitForRoom(transfer);
      }
    }
    if (buffer.length > 0) {
      post(MessageType.CHUNK, {
        downloadId,
        transferId,
        seq,
        offset,
        data: bytesToBase64(buffer),
      });
    }
    post(MessageType.ASSIST_COMPLETED, { downloadId, transferId });
  } catch (e) {
    post(MessageType.ASSIST_FAILED, {
      downloadId,
      transferId,
      code: "ASSIST_STREAM_FAILED",
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    transfers.delete(transferId);
  }
}

/** Reset module state. Test-only. */
export function __resetForTests(): void {
  for (const [, p] of pending) clearTimeout(p.timer);
  pending.clear();
  port = null;
  connected = false;
  handshaken = false;
  handshaking = null;
  lastError = null;
  lastErrorCode = null;
  disconnectedAt = 0;
  idSeq = 0;
}
