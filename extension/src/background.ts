import {
  handshake,
  postNative,
  setAckBridge,
  setAssistBridge,
  setCancelBridge,
  status,
  submit,
} from "./nativeClient";
import { MessageType } from "./types";
import type { AssistRequestPayload } from "./types";
import { pageAssistFetch } from "./pageAssistFetch";

const MENU_ID = "velox-download-link";

const DEFAULT_ICON = {
  "16": "icons/16.png",
  "32": "icons/32.png",
  "48": "icons/48.png",
  "128": "icons/128.png",
};
const GREEN_ICON = {
  "16": "icons/green/16.png",
  "32": "icons/green/32.png",
  "48": "icons/green/48.png",
  "128": "icons/green/128.png",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function flashError(): void {
  try {
    chrome.action.setBadgeBackgroundColor({ color: "#f0533d" });
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setTitle({ title: "Velox: request failed" });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "Velox" });
    }, 4000);
  } catch {
    // badge is best-effort
  }
}

async function flashSuccess(): Promise<void> {
  try {
    chrome.action.setBadgeBackgroundColor({ color: "#33d6a6" });
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setTitle({ title: "Velox: added to queue" });

    // Flicker the toolbar icon green a few times, then settle briefly.
    for (let i = 0; i < 3; i++) {
      await chrome.action.setIcon({ path: GREEN_ICON });
      await sleep(160);
      await chrome.action.setIcon({ path: DEFAULT_ICON });
      await sleep(160);
    }
    await chrome.action.setIcon({ path: GREEN_ICON });
    await sleep(900);
    await chrome.action.setIcon({ path: DEFAULT_ICON });

    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "Velox" });
  } catch {
    // cosmetic feedback only
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Download with Velox",
    contexts: ["link"],
  });
  handshake();
});

chrome.runtime.onStartup.addListener(() => handshake());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.linkUrl) return;
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

async function waitForComplete(tabId: number, timeoutMs = 15000): Promise<void> {
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
      message: "Invalid URL.",
    });
    return;
  }

  const { assistEnabled } = await chrome.storage.local.get({ assistEnabled: true });
  if (assistEnabled === false) {
    postNative(MessageType.ASSIST_FAILED, {
      downloadId: req.downloadId,
      transferId,
      code: "ASSIST_DISABLED",
      message: "Browser assistance is turned off in the extension.",
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
      message: `Open ${origin} in a browser tab, then retry.`,
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
    .catch((e) => {
      postNative(MessageType.ASSIST_FAILED, {
        downloadId: req.downloadId,
        transferId,
        code: "ASSIST_INJECT_FAILED",
        message: e instanceof Error ? e.message : String(e),
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
      sendResponse(status());
      break;
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
      }, 60000);
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
      postNative(MessageType.ASSIST_FAILED, {
        downloadId: msg.downloadId,
        transferId: msg.transferId,
        code: msg.code,
        message: msg.message,
      });
      cleanupAssist(msg.transferId);
      sendResponse({ ok: true });
      break;
    default:
      return false;
  }
  return true;
});
