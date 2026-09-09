"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Smartphone } from "lucide-react";
import { getAuth } from "firebase/auth";
import { firebaseApp } from "../lib/firebase";

type MonitoringReport = {
  id: string;
  type: "javascript" | "promise" | "resource" | "network" | "react";
  message: string;
  stack: string;
  route: string;
  screen: string;
  release: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  resolvedAt: number | null;
  device: {
    browser: string;
    os: string;
    viewport: string;
    installed: boolean;
    online: boolean;
    connection: string;
  };
};

const labels: Record<MonitoringReport["type"], string> = {
  javascript: "Błąd aplikacji",
  promise: "Operacja w tle",
  resource: "Ładowanie pliku",
  network: "Połączenie z serwerem",
  react: "Widok aplikacji",
};

const formatDate = (value: number) => new Intl.DateTimeFormat("pl-PL", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
}).format(new Date(value));

const monitoredRequest = async (method: "GET" | "PATCH", body?: unknown) => {
  const user = getAuth(firebaseApp).currentUser;
  if (!user) throw new Error("Zaloguj się ponownie, aby odczytać monitoring.");
  const response = await fetch("/api/client-errors", {
    method,
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error("Nie udało się połączyć z monitoringiem.");
  return response.json();
};

export default function ErrorMonitoringPanel() {
  const [reports, setReports] = useState<MonitoringReport[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState("");
  const [error, setError] = useState("");

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await monitoredRequest("GET");
      setReports(Array.isArray(result.reports) ? result.reports : []);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Nie udało się odczytać monitoringu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadReports(); }, [loadReports]);

  const activeReports = useMemo(() => reports.filter((report) => !report.resolvedAt), [reports]);
  const visibleReports = showResolved ? reports : activeReports;
  const occurrences = activeReports.reduce((sum, report) => sum + Number(report.count || 0), 0);
  const devices = new Set(activeReports.map((report) => `${report.device.os}|${report.device.browser}`)).size;

  const toggleResolved = async (report: MonitoringReport) => {
    if (updatingId) return;
    setUpdatingId(report.id);
    setError("");
    const previous = reports;
    const resolvedAt = report.resolvedAt ? null : report.lastSeenAt || 1;
    setReports((items) => items.map((item) => item.id === report.id ? { ...item, resolvedAt } : item));
    try {
      const result = await monitoredRequest("PATCH", { id: report.id, resolved: !report.resolvedAt });
      setReports((items) => items.map((item) => item.id === report.id ? result.report : item));
    } catch (failure) {
      setReports(previous);
      setError(failure instanceof Error ? failure.message : "Nie udało się zmienić statusu błędu.");
    } finally {
      setUpdatingId("");
    }
  };

  return (
    <section className="error-monitor" aria-labelledby="error-monitor-title">
      <header className="error-monitor-heading">
        <div>
          <p className="eyebrow">DIAGNOSTYKA TELEFONÓW</p>
          <h2 id="error-monitor-title">Monitoring błędów</h2>
          <span>Bez nazwisk, telefonów, e-maili i treści formularzy.</span>
        </div>
        <button type="button" onClick={() => void loadReports()} disabled={loading}>
          <RefreshCw aria-hidden="true" className={loading ? "is-spinning" : ""} />
          Odśwież
        </button>
      </header>

      <div className="error-monitor-summary" aria-label="Podsumowanie monitoringu">
        <article className={activeReports.length ? "warning" : "healthy"}>
          {activeReports.length ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
          <span><strong>{activeReports.length}</strong> aktywnych błędów</span>
        </article>
        <article><strong>{occurrences}</strong><span>wystąpień</span></article>
        <article><strong>{devices}</strong><span>typów urządzeń</span></article>
      </div>

      <div className="error-monitor-filters">
        <button type="button" className={!showResolved ? "active" : ""} onClick={() => setShowResolved(false)}>
          Aktywne ({activeReports.length})
        </button>
        <button type="button" className={showResolved ? "active" : ""} onClick={() => setShowResolved(true)}>
          Wszystkie ({reports.length})
        </button>
      </div>

      {error ? <p className="error-monitor-message" role="alert">{error}</p> : null}
      {loading ? (
        <div className="error-monitor-list" aria-label="Wczytywanie błędów">
          {[0, 1, 2].map((item) => <article className="error-monitor-skeleton skeleton-block" key={item} />)}
        </div>
      ) : visibleReports.length === 0 ? (
        <div className="error-monitor-empty">
          <CheckCircle2 aria-hidden="true" />
          <h3>{showResolved ? "Brak zapisanych zgłoszeń" : "Aplikacja działa spokojnie"}</h3>
          <p>Nowe problemy z telefonów pojawią się tutaj automatycznie.</p>
        </div>
      ) : (
        <div className="error-monitor-list">
          {visibleReports.map((report) => (
            <article className={report.resolvedAt ? "is-resolved" : ""} key={report.id}>
              <div className="error-monitor-card-title">
                <span>{labels[report.type] ?? "Błąd aplikacji"}</span>
                <strong>{report.count}×</strong>
              </div>
              <h3>{report.message}</h3>
              <div className="error-monitor-device">
                <Smartphone aria-hidden="true" />
                <span>{report.device.os} · {report.device.browser}</span>
              </div>
              <dl>
                <div><dt>Ekran</dt><dd>{report.screen}</dd></div>
                <div><dt>Rozmiar</dt><dd>{report.device.viewport}{report.device.installed ? " · PWA" : ""}</dd></div>
                <div><dt>Połączenie</dt><dd>{report.device.online ? report.device.connection : "offline"}</dd></div>
                <div><dt>Ostatnio</dt><dd>{formatDate(report.lastSeenAt)}</dd></div>
                <div><dt>Wersja</dt><dd>{report.release.slice(0, 8)}</dd></div>
              </dl>
              {report.stack ? <details><summary>Szczegóły techniczne</summary><pre>{report.stack}</pre></details> : null}
              <button
                className="error-monitor-resolve"
                type="button"
                disabled={updatingId === report.id}
                onClick={() => void toggleResolved(report)}
              >
                {updatingId === report.id ? "Zapisywanie…" : report.resolvedAt ? "Przywróć jako aktywny" : "Oznacz jako rozwiązany"}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
