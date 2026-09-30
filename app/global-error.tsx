"use client";

import { useEffect } from "react";

import { reportClientError } from "@/lib/client/report.ts";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError("global", error, error.digest);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 40 }}>
        <h2>Something went wrong</h2>
        <p>{error.message}</p>
        <p>The details were sent to the server log.</p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
