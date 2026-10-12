import { ErrorCode, MessageType, PROTOCOL_VERSION, VeloxError } from "./types";
import type {
  AssistRequestPayload,
  DownloadAcceptedPayload,
  DownloadRequestPayload,
  Envelope,
  ErrorPayload,
  HelloPayload,
  StatusResponse,
  SubmitResult,
} from "./types";

const HOST_NAME = "com.velox.native_host";

/** Stable per-service-worker identity, reported to Velox in `hello`. */
const CLIENT_ID = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2);
  }
})();

export const REQUEST_TIMEOUT_MS = 8000;
export const HANDSHAKE_TIMEOUT_MS = 4000;
/** After a disconnect, fail fast for a short window instead of reconnecting. */
export const RECONNECT_COOLDOWN_MS = 3000;

let port: chrome.runtime.Port | null = null;
let connected = false;
let lastError: string | null = null;
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
}

const pending = new Map<string, Pending>();

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

function classifyDisconnect(): VeloxError {
  const raw = chrome.runtime.lastError?.message ?? "native host disconnected";
  const notFound = /not found|not registered|cannot connect/i.test(raw);
  return new VeloxError(
    notFound ? ErrorCode.HOST_NOT_FOUND : ErrorCode.APP_NOT_RUNNING,
    notFound ? "Velox browser host is not installed or registered." : "Velox is not running."
  );
}

function ensurePort(): chrome.runtime.Port {
  if (port) return port;

  if (disconnectedAt && Date.now() - disconnectedAt < RECONNECT_COOLDOWN_MS) {
    throw new VeloxError(ErrorCode.APP_NOT_RUNNING, "Velox is not running.");
  }

  const next = chrome.runtime.connectNative(HOST_NAME);

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
      // M2 stub: acknowledge. Streaming arrives in M3.
      try {
        const req = (msg.payload ?? {}) as AssistRequestPayload;
        next.postMessage(
          envelope(msg.id, MessageType.ASSIST_STARTED, {
            downloadId: req.downloadId,
            transferId: `t-${msg.id}`,
          })
        );
        chrome.storage.local.set({ lastAssist: Date.now() });
      } catch {
        // ignore
      }
      return;
    }
    if (msg.type === MessageType.READY) {
      connected = true;
      lastError = null;
    } else if (msg.type === MessageType.ERROR) {
      lastError = ((msg.payload ?? {}) as ErrorPayload).message ?? "unknown error";
    }
  });

  next.onDisconnect.addListener(() => {
    const err = classifyDisconnect();
    connected = false;
    lastError = err.message;
    disconnectedAt = Date.now();
    if (port === next) port = null;
    rejectAllPending(err);
  });

  port = next;
  return next;
}

function sendRequest(
  type: string,
  payload: unknown,
  { timeoutMs = REQUEST_TIMEOUT_MS, expect }: SendOptions = {}
): Promise<Envelope> {
  return new Promise((resolve, reject) => {
    let target: chrome.runtime.Port;
    try {
      target = ensurePort();
    } catch (e) {
      reject(e instanceof VeloxError ? e : new VeloxError(ErrorCode.APP_NOT_RUNNING, String(e)));
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

export function handshake(): void {
  if (port || (disconnectedAt && Date.now() - disconnectedAt < RECONNECT_COOLDOWN_MS)) return;
  const hello: HelloPayload = {
    extVersion: chrome.runtime.getManifest().version,
    clientId: CLIENT_ID,
  };
  sendRequest(MessageType.HELLO, hello, {
    timeoutMs: HANDSHAKE_TIMEOUT_MS,
    expect: MessageType.READY,
  }).catch(() => {});
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
    const payload: DownloadRequestPayload = { url, source, ...context };
    const res = await sendRequest(MessageType.DOWNLOAD_REQUEST, payload, {
      expect: MessageType.DOWNLOAD_ACCEPTED,
    });
    const accepted = (res.payload ?? {}) as DownloadAcceptedPayload;
    connected = true;
    lastError = null;
    return { ok: true, downloadId: accepted.downloadId };
  } catch (e) {
    const err = e instanceof VeloxError ? e : new VeloxError(ErrorCode.INTERNAL, String(e));
    lastError = err.message;
    return { ok: false, code: err.code, error: err.message };
  }
}

export function status(): StatusResponse {
  return { connected, lastError, clientId: CLIENT_ID };
}

/** Reset module state. Test-only. */
export function __resetForTests(): void {
  for (const [, p] of pending) clearTimeout(p.timer);
  pending.clear();
  port = null;
  connected = false;
  lastError = null;
  disconnectedAt = 0;
  idSeq = 0;
}
