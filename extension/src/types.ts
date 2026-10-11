export const PROTOCOL_VERSION = 1;

export interface Envelope<T = unknown> {
  version: number;
  id: string;
  type: string;
  payload: T;
}

export const MessageType = {
  HELLO: "hello",
  READY: "ready",
  PING: "ping",
  PONG: "pong",
  DOWNLOAD_REQUEST: "download_request",
  DOWNLOAD_ACCEPTED: "download_accepted",
  DOWNLOAD_REJECTED: "download_rejected",
  ASSIST_REQUEST: "assist_request",
  ASSIST_STARTED: "assist_started",
  CHUNK: "chunk",
  CHUNK_ACK: "chunk_ack",
  ASSIST_COMPLETED: "assist_completed",
  CANCEL_DOWNLOAD: "cancel_download",
  ERROR: "error",
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const ErrorCode = {
  APP_NOT_RUNNING: "APP_NOT_RUNNING",
  HOST_NOT_FOUND: "HOST_NOT_FOUND",
  TIMEOUT: "TIMEOUT",
  PORT_DISCONNECTED: "PORT_DISCONNECTED",
  INVALID_URL: "INVALID_URL",
  REJECTED: "REJECTED",
  INTERNAL: "INTERNAL",
  ASSIST_UNSUPPORTED: "ASSIST_UNSUPPORTED",
  ASSIST_FETCH_FAILED: "ASSIST_FETCH_FAILED",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Browser-assisted transfer tuning (bytes). */
export const CHUNK_SIZE_BYTES = 1024 * 1024;
export const MAX_UNACKED_BYTES = 4 * 1024 * 1024;

export interface HelloPayload {
  extVersion: string;
  clientId: string;
}

export interface ReadyPayload {
  appVersion: string;
  capabilities: string[];
}

export interface DownloadRequestPayload {
  url: string;
  source: string;
  pageUrl?: string;
  referrer?: string;
  userAgent?: string;
  suggestedName?: string;
}

export interface DownloadAcceptedPayload {
  downloadId: string;
}

/** Reason the app is asking the browser to assist with a transfer. */
export type AssistReason =
  | "cf_challenge"
  | "403"
  | "cookie_required"
  | "native_failed";

export interface AssistRequestPayload {
  downloadId: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  range?: { start: number; end: number };
  reason: AssistReason;
}

export interface AssistStartedPayload {
  downloadId: string;
  transferId: string;
}

/** One base64-encoded chunk of browser-fetched data. */
export interface ChunkPayload {
  transferId: string;
  seq: number;
  offset: number;
  data: string;
}

export interface ChunkAckPayload {
  transferId: string;
  seq: number;
}

export interface AssistCompletedPayload {
  downloadId: string;
  transferId: string;
}

export interface CancelDownloadPayload {
  downloadId: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface StatusResponse {
  connected: boolean;
  lastError: string | null;
  clientId: string;
}

export class VeloxError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "VeloxError";
    this.code = code;
  }
}

export interface SubmitResult {
  ok: boolean;
  code?: ErrorCode;
  error?: string;
  downloadId?: string;
}
