import {
  handshake,
  postNative,
  reconnect,
  refreshStatus,
  setAckBridge,
  setAssistBridge,
  setCancelBridge,
  submit,
} from "./nativeClient";
import { MessageType } from "./types";
import type { AssistRequestPayload } from "./types";
import { pageAssistFetch } from "./pageAssistFetch";
import {
  ASSIST_TAB_LOAD_TIMEOUT_MS,
  BADGE_ERROR_COLOR,
  BADGE_RESET_MS,
  BADGE_SUCCESS_COLOR,
  CHUNK_ACK_TIMEOUT_MS,
  CONTEXT_MENU_ID,
  DEFAULT_ICONS,
  GREEN_ICONS,
} from "./constants";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function flashError(): void {
  try {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_ERROR_COLOR });
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setTitle({
      title: "Velox: request failed — open the Velox extension popup for help",
    });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "Velox" });
    }, BADGE_RESET_MS);
  } catch {
    // badge is best-effort
  }
}

async function flashSuccess(): Promise<void> {
  try {
    chrome.action.setBadgeBackgroundColor({ color: BADGE_SUCCESS_COLOR });
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setTitle({ title: "Velox: added to queue" });

    // Flicker the toolbar icon green a few times, then settle briefly.
    for (let i = 0; i < 3; i++) {
      await chrome.action.setIcon({ path: GREEN_ICONS });
      await sleep(160);
      await chrome.action.setIcon({ path: DEFAULT_ICONS });
      await sleep(160);
    }
    await chrome.action.setIcon({ path: GREEN_ICONS });
    await sleep(900);
    await chrome.action.setIcon({ path: DEFAULT_ICONS });

    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "Velox" });
  } catch {
    // cosmetic feedback only
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "Download with Velox",
    contexts: ["link"],
  });
  handshake();
});

chrome.runtime.onStartup.addListener(() => handshake());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.linkUrl) return;
  void submit(info.linkUrl, "context_menu", {
    pageUrl: info.pageUrl,
    referrer: tab?.url,
    suggestedName: info.selectionText || undefined,
  }).then((res) => {
    if (res.ok) flashSuccess();
    else flashError();
  });
});

// --- Browser assistance (page-context fetch) ---------------------------------
// Cloudflare managed challenges block service-worker fetches, but a fetch
// issued from the origin's page context passes. So assist runs a fetch in a
// tab on the target origin and streams chunks back through the service worker.

interface AssistState {
  downloadId: string;
  tabId: number;
  createdTab: boolean;
  cancelled: boolean;
  acks: Map<number, (cancelled: boolean) => void>;
}

const assistStates = new Map<string, AssistState>();

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

async function findOrCreateTab(
  origin: string
): Promise<{ tabId: number; created: boolean } | null> {
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  const existing = tabs.find((t) => t.id != null && t.url && sameOrigin(t.url, origin));
  if (existing?.id != null) return { tabId: existing.id, created: false };
  // Open the origin root (not the file URL) so a document loads — navigating to
  // the file can make Chrome take over with a download, leaving no page to
  // fetch from. Focus it so the user can clear any challenge.
  const created = await chrome.tabs.create({ url: `${origin}/`, active: true });
  return created.id != null ? { tabId: created.id, created: true } : null;
}

function cleanupAssist(transferId: string): void {
  const state = assistStates.get(transferId);
  if (!state) return;
  if (state.createdTab) {
    chrome.tabs.remove(state.tabId).catch(() => {});
  }
  state.acks.forEach((resolve) => resolve(true));
  assistStates.delete(transferId);
}

/** Map an assist failure code to an actionable, user-facing message. */
function friendlyMessage(code: string, detail: string | undefined, origin: string | undefined): string {
  switch (code) {
    case "ASSIST_DISABLED":
      return "Browser assistance is turned off in the Velox extension.";
    case "ASSIST_INVALID_URL":
      return "That doesn't look like a downloadable URL.";
    case "ASSIST_NO_TAB":
      return `Open ${origin ?? "the site"} in a browser tab, then retry.`;
    case "ASSIST_INJECT_FAILED":
      return "Couldn't start the browser fetcher. Check the extension's site access, then retry.";
    case "ASSIST_FETCH_FAILED":
      return detail && detail.startsWith("HTTP")
        ? `The browser couldn't fetch the file (${detail}). Open the site and verify access, then retry.`
        : "The browser couldn't fetch the file. Open the site and verify access, then retry.";
    case "ASSIST_CHALLENGE":
      return "The website returned a challenge page instead of the file. Complete the check in the browser, then retry.";
    case "ASSIST_NOT_READY":
      return "The website wasn't ready. Complete any check in the browser, then retry.";
    case "ASSIST_STREAM_FAILED":
      return "The transfer was interrupted. Retry to restart the download.";
    case "ASSIST_SIZE_MISMATCH":
      return "The file couldn't be verified (incomplete response), so it wasn't completed.";
    default:
      return "Browser assistance failed. Open the site in your browser and retry.";
  }
}

async function waitForComplete(tabId: number, timeoutMs = ASSIST_TAB_LOAD_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return;
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function assistViaPage(req: AssistRequestPayload): Promise<void> {
  const transferId = `t-${req.downloadId}-${Date.now().toString(36)}`;
  let origin: string;
  try {
    origin = new URL(req.url).origin;
  } catch {
    postNative(MessageType.ASSIST_FAILED, {
      downloadId: req.downloadId,
      transferId,
      code: "ASSIST_INVALID_URL",
      message: friendlyMessage("ASSIST_INVALID_URL", undefined, undefined),
    });
    return;
  }

  const { assistEnabled } = await chrome.storage.local.get({ assistEnabled: true });
  if (assistEnabled === false) {
    postNative(MessageType.ASSIST_FAILED, {
      downloadId: req.downloadId,
      transferId,
      code: "ASSIST_DISABLED",
      message: friendlyMessage("ASSIST_DISABLED", undefined, undefined),
    });
    return;
  }

  let found: { tabId: number; created: boolean } | null = null;
  try {
    found = await findOrCreateTab(origin);
  } catch {
    found = null;
  }
  if (!found) {
    postNative(MessageType.ASSIST_FAILED, {
      downloadId: req.downloadId,
      transferId,
      code: "ASSIST_NO_TAB",
      message: friendlyMessage("ASSIST_NO_TAB", undefined, origin),
    });
    return;
  }

  assistStates.set(transferId, {
    downloadId: req.downloadId,
    tabId: found.tabId,
    createdTab: found.created,
    cancelled: false,
    acks: new Map(),
  });
  // Tell the app we're waiting on the browser (challenge/load), so it can show
  // a waiting state instead of a failure.
  postNative(MessageType.ASSIST_PENDING, {
    downloadId: req.downloadId,
    transferId,
  });
  await waitForComplete(found.tabId);

  chrome.scripting
    .executeScript({
      target: { tabId: found.tabId },
      func: pageAssistFetch,
      args: [req.url, req.downloadId, transferId],
    })
    .catch(() => {
      postNative(MessageType.ASSIST_FAILED, {
        downloadId: req.downloadId,
        transferId,
        code: "ASSIST_INJECT_FAILED",
        message: friendlyMessage("ASSIST_INJECT_FAILED", undefined, undefined),
      });
      cleanupAssist(transferId);
    });
}

// The page-context fetcher is injected from ./pageAssistFetch.

setAssistBridge((req) => {
  void assistViaPage(req);
});

setAckBridge((ack) => {
  const state = assistStates.get(ack.transferId);
  if (!state) return;
  const resolve = state.acks.get(ack.seq);
  if (resolve) {
    state.acks.delete(ack.seq);
    resolve(Boolean(ack.cancelled));
  }
  if (ack.cancelled) {
    state.cancelled = true;
    cleanupAssist(ack.transferId);
  }
});

setCancelBridge((downloadId) => {
  for (const state of assistStates.values()) {
    if (state.downloadId === downloadId) {
      state.cancelled = true;
      state.acks.forEach((resolve) => resolve(true));
      state.acks.clear();
    }
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg?.type) {
    case "velox:getStatus":
      void refreshStatus().then(sendResponse);
      return true;
    case "velox:reconnect":
      void reconnect().then(sendResponse);
      return true;
    case "velox:submit":
      void submit(msg.url, msg.source ?? "popup", { pageUrl: msg.pageUrl }).then(sendResponse);
      return true;
    case "velox:assistStarted": {
      const state = assistStates.get(msg.transferId);
      if (state?.cancelled) {
        sendResponse({ cancelled: true });
        break;
      }
      postNative(MessageType.ASSIST_STARTED, {
        downloadId: msg.downloadId,
        transferId: msg.transferId,
        totalBytes: msg.totalBytes ?? 0,
      });
      sendResponse({ ok: true });
      break;
    }
    case "velox:assistChunk": {
      const state = assistStates.get(msg.transferId);
      if (!state || state.cancelled) {
        sendResponse({ cancelled: true });
        break;
      }
      const posted = postNative(MessageType.CHUNK, {
        downloadId: msg.downloadId,
        transferId: msg.transferId,
        seq: msg.seq,
        offset: msg.offset,
        data: msg.data,
      });
      if (!posted) {
        sendResponse({ cancelled: true });
        cleanupAssist(msg.transferId);
        break;
      }
      // Hold the response until the app acknowledges this chunk so the page
      // can't outrun Velox's writes (end-to-end backpressure).
      const timer = setTimeout(() => {
        state.acks.delete(msg.seq);
        sendResponse({ cancelled: true });
        cleanupAssist(msg.transferId);
      }, CHUNK_ACK_TIMEOUT_MS);
      state.acks.set(msg.seq, (cancelled) => {
        clearTimeout(timer);
        sendResponse({ cancelled });
      });
      return true;
    }
    case "velox:assistCompleted":
      postNative(MessageType.ASSIST_COMPLETED, {
        downloadId: msg.downloadId,
        transferId: msg.transferId,
      });
      cleanupAssist(msg.transferId);
      sendResponse({ ok: true });
      break;
    case "velox:assistFailed":
      console.warn("[velox assist]", msg.code, msg.message);
      postNative(MessageType.ASSIST_FAILED, {
        downloadId: msg.downloadId,
        transferId: msg.transferId,
        code: msg.code,
        message: friendlyMessage(msg.code, msg.message, undefined),
      });
      cleanupAssist(msg.transferId);
      sendResponse({ ok: true });
      break;
    default:
      return false;
  }
  return true;
});
