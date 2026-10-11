import { handshake, status, submit } from "./nativeClient";

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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg?.type) {
    case "velox:getStatus":
      sendResponse(status());
      break;
    case "velox:submit":
      void submit(msg.url, msg.source ?? "popup", { pageUrl: msg.pageUrl }).then(sendResponse);
      return true;
    default:
      return false;
  }
  return true;
});
