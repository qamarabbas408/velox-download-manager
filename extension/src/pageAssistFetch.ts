/**
 * Self-contained page-context fetcher.
 *
 * Injected into a tab on the target origin via `chrome.scripting.executeScript`.
 * It runs in the page (not the service worker), which satisfies Cloudflare
 * challenges that block service-worker fetches, and streams the response body
 * back to the service worker in ~1 MiB base64 chunks.
 *
 * IMPORTANT: `chrome.scripting.executeScript({ func })` serializes this
 * function's source and runs it in the page, so it must be entirely
 * self-contained — no references to module-scope identifiers or imports.
 */
export async function pageAssistFetch(
  url: string,
  downloadId: string,
  transferId: string
): Promise<void> {
  const send = (msg: Record<string, unknown>) =>
    new Promise<{ cancelled?: boolean }>((resolve) =>
      chrome.runtime.sendMessage(msg, (resp) => resolve((resp as { cancelled?: boolean }) || {}))
    );
  const b64 = (bytes: Uint8Array): string => {
    let s = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      s += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return btoa(s);
  };
  const merge = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    if (a.length === 0) return b;
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  };
  const fail = (code: string, message: string) =>
    send({ type: "velox:assistFailed", downloadId, transferId, code, message });

  let res: Response;
  try {
    res = await fetch(url, { credentials: "include" });
  } catch (e) {
    await fail("ASSIST_FETCH_FAILED", e instanceof Error ? e.message : String(e));
    return;
  }
  if (!res.ok || !res.body) {
    await fail("ASSIST_FETCH_FAILED", `HTTP ${res.status}`);
    return;
  }
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.startsWith("text/html")) {
    await fail("ASSIST_CHALLENGE", "Server returned an HTML page.");
    return;
  }
  const expected = Number(res.headers.get("content-length") || 0) || 0;
  console.log("[velox assist/page]", {
    finalUrl: res.url,
    status: res.status,
    contentType: ct,
    expected,
  });

  const started = await send({ type: "velox:assistStarted", downloadId, transferId });
  if (started.cancelled) return;

  const reader = res.body.getReader();
  const CHUNK = 1024 * 1024;
  let seq = 0;
  let offset = 0;
  let buf = new Uint8Array(0);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf = merge(buf, value);
      while (buf.length >= CHUNK) {
        const part = buf.subarray(0, CHUNK);
        const r = await send({
          type: "velox:assistChunk",
          downloadId,
          transferId,
          seq,
          offset,
          data: b64(part),
        });
        if (r.cancelled) {
          await reader.cancel().catch(() => {});
          return;
        }
        offset += part.length;
        seq += 1;
        buf = buf.subarray(CHUNK);
      }
    }
    if (buf.length > 0) {
      const r = await send({
        type: "velox:assistChunk",
        downloadId,
        transferId,
        seq,
        offset,
        data: b64(buf),
      });
      offset += buf.length;
      if (r.cancelled) {
        await reader.cancel().catch(() => {});
        return;
      }
    }
    if (expected > 0 && offset !== expected) {
      await fail("ASSIST_SIZE_MISMATCH", `Expected ${expected} bytes, received ${offset}.`);
      return;
    }
    await send({ type: "velox:assistCompleted", downloadId, transferId });
  } catch (e) {
    await fail("ASSIST_STREAM_FAILED", e instanceof Error ? e.message : String(e));
  }
}
