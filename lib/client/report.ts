// Sends a browser-side error to the server log, so problems on the live site
// can be diagnosed. Only the error text and where it happened; no photos.

export function reportClientError(where: string, error: unknown, extra?: string) {
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    const body = JSON.stringify({
      where,
      message: e.message.slice(0, 500),
      stack: (e.stack ?? "").slice(0, 2000),
      extra: extra?.slice(0, 2000),
      url: location.pathname,
      userAgent: navigator.userAgent.slice(0, 300),
    });
    void fetch("/api/client-error", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // Reporting must never cause a second error.
  }
}
