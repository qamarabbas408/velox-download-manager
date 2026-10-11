import { useEffect, useState } from "react";
import type { StatusResponse } from "../types";

type Result = { kind: "ok" | "error"; text: string };

export default function App() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<StatusResponse>({
    connected: false,
    lastError: null,
  });
  const [assist, setAssist] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const refresh = () => {
    chrome.runtime.sendMessage({ type: "velox:getStatus" }, (res?: StatusResponse) => {
      if (res) setStatus(res);
    });
  };

  useEffect(() => {
    refresh();
    chrome.storage.local.get({ assistEnabled: true }, (v) =>
      setAssist(Boolean(v.assistEnabled))
    );
  }, []);

  const submit = () => {
    const target = url.trim();
    if (!target || busy) return;
    setBusy(true);
    setResult(null);
    chrome.runtime.sendMessage(
      { type: "velox:submit", url: target, source: "popup" },
      (res?: { ok: boolean; error?: string }) => {
        setBusy(false);
        setResult(
          res?.ok
            ? { kind: "ok", text: "Added to Velox" }
            : { kind: "error", text: res?.error ?? "Failed to send" }
        );
        refresh();
      }
    );
  };

  const toggleAssist = () => {
    const next = !assist;
    setAssist(next);
    chrome.storage.local.set({ assistEnabled: next });
  };

  return (
    <div className="popup">
      <header className="popup__header">
        <img className="popup__logo" src="/logo.png" alt="Velox" />
        <div className="popup__titles">
          <span className="popup__brand">Velox</span>
          <span className="popup__sub">Download manager</span>
        </div>
        <span className={`badge ${status.connected ? "badge--ok" : "badge--off"}`}>
          {status.connected ? "Connected" : "Offline"}
        </span>
      </header>

      <div className="field">
        <label className="field__label" htmlFor="velox-url">
          Download URL
        </label>
        <input
          id="velox-url"
          className="field__input"
          type="text"
          placeholder="https://example.com/file.zip"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (result) setResult(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </div>

      <button className="btn" onClick={submit} disabled={busy || !url.trim()}>
        {busy ? "Sending…" : "Send to Velox"}
      </button>

      {result && (
        <div className={`banner banner--${result.kind}`} role="status">
          <span className="banner__dot" />
          <span className="banner__text">{result.text}</span>
        </div>
      )}

      {!status.connected && (
        <p className="hint">
          {status.lastError ?? "Start Velox to receive downloads."}
        </p>
      )}

      <label className="toggle">
        <input type="checkbox" checked={assist} onChange={toggleAssist} />
        <span>Browser assistance for protected sites</span>
      </label>
    </div>
  );
}
