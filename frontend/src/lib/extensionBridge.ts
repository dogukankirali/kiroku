// Asks the Kiroku extension (through its content script on Kiroku pages) to download the chapters
// a manga is missing. Resolves with null when the extension is not installed.

export type CatchUpRequest = { title: string; series: string; after: number };

export function requestMangaCatchUp(req: CatchUpRequest, timeoutMs = 2500): Promise<boolean | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      const msg = event.data;
      if (event.source !== window || !msg || msg.source !== "kiroku-extension" || msg.type !== "MANGA_CATCH_UP_ACK" || msg.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(Boolean(msg.ok));
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "kiroku-page", type: "MANGA_CATCH_UP", id, ...req }, window.location.origin);
  });
}
