"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/client/report.ts";

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportClientError("page", error, error.digest), [error]);
  return (
    <div style={{ padding: 40, maxWidth: 560, margin: "0 auto" }}>
      <h2>Something went wrong on this page</h2>
      <p className="hint">{error.message}</p>
      <p className="hint">The details were sent to the server log. Your worklist lives in this tab, so reloading clears it.</p>
      <button className="btn btn-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
