// Central configuration for the Velox extension. Values here are the ones most
// likely to change (links, timeouts, sizes, ids); import them instead of
// duplicating literals across modules.

/** Native-messaging host name registered by the Velox desktop app. */
export const NATIVE_HOST_NAME = "com.velox.native_host";

/** Protocol version exchanged with the desktop app. */
export const PROTOCOL_VERSION = 1;

/** Where users can download the desktop app. */
export const SOURCEFORGE_URL =
  "https://sourceforge.net/projects/velox-download-manager/";

// --- Timeouts (milliseconds) -------------------------------------------------
export const REQUEST_TIMEOUT_MS = 8000;
export const HANDSHAKE_TIMEOUT_MS = 4000;
/** Fail fast for this long after a disconnect instead of reconnecting. */
export const RECONNECT_COOLDOWN_MS = 3000;
/** How long to wait for the app to acknowledge a streamed chunk. */
export const CHUNK_ACK_TIMEOUT_MS = 60000;
/** How long to wait for an assist tab to finish loading. */
export const ASSIST_TAB_LOAD_TIMEOUT_MS = 15000;
/** How long the failure badge/tooltip stays visible. */
export const BADGE_RESET_MS = 4000;

// --- Browser-assisted transfer tuning (bytes) --------------------------------
export const ASSIST_CHUNK_BYTES = 1024 * 1024;
export const MAX_UNACKED_BYTES = 4 * 1024 * 1024;

// --- Toolbar / context menu --------------------------------------------------
export const CONTEXT_MENU_ID = "velox-download-link";
export const BADGE_ERROR_COLOR = "#f0533d";
export const BADGE_SUCCESS_COLOR = "#33d6a6";

export const DEFAULT_ICONS = {
  "16": "icons/16.png",
  "32": "icons/32.png",
  "48": "icons/48.png",
  "128": "icons/128.png",
} as const;

export const GREEN_ICONS = {
  "16": "icons/green/16.png",
  "32": "icons/green/32.png",
  "48": "icons/green/48.png",
  "128": "icons/green/128.png",
} as const;
