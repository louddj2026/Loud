"use client";

import { useEffect } from "react";
import { diagnosticErrorDetails, reportClientDiagnostic } from "../../lib/client-diagnostics-client";

export default function DjError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientDiagnostic("dj-react-error", { ...diagnosticErrorDetails(error), digest: error.digest });
    const recoveryKey = `crowd2-dj-recovery:${error.digest ?? error.message}`;
    if (sessionStorage.getItem(recoveryKey)) return;
    sessionStorage.setItem(recoveryKey, "1");
    const timer = window.setTimeout(reset, 400);
    return () => window.clearTimeout(timer);
  }, [error, reset]);

  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#05080a", color: "#d8efff", fontFamily: "monospace" }}>
    <section style={{ display: "grid", gap: 12, maxWidth: 560, padding: 24, border: "1px solid #ff5a67", background: "#16090c" }}>
      <h1 style={{ margin: 0 }}>Crowd caught a booth error</h1>
      <p style={{ margin: 0 }}>The first recovery is automatic. If the error repeats, the crash details are already saved locally for diagnosis.</p>
      <button type="button" onClick={reset} style={{ padding: 12, border: "1px solid #55a7ff", background: "#0b1b26", color: "#d8efff", fontWeight: 900 }}>RECOVER BOOTH</button>
    </section>
  </main>;
}
