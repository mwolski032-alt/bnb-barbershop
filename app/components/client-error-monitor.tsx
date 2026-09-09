"use client";

import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { reportClientError, startClientErrorMonitoring } from "../lib/client-error-monitoring";

class ApplicationErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError("react", error.message, `${error.stack ?? ""}\n${info.componentStack ?? ""}`);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-error-view">
        <div>
          <span aria-hidden="true">B&apos;n&apos;B</span>
          <h1>Coś poszło nie tak</h1>
          <p>Błąd został bezpiecznie zgłoszony. Odśwież aplikację, aby spróbować ponownie.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Odśwież aplikację
          </button>
        </div>
      </main>
    );
  }
}

export default function ClientErrorMonitor({ children }: { children: ReactNode }) {
  useEffect(() => startClientErrorMonitoring(), []);
  return <ApplicationErrorBoundary>{children}</ApplicationErrorBoundary>;
}

