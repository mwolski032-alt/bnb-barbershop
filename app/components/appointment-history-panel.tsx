"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DatabaseBackup, History, RefreshCw, ShieldCheck } from "lucide-react";
import { getAuth } from "firebase/auth";
import { firebaseApp } from "../lib/firebase";

type AppointmentSnapshot = {
  id?: string;
  clientName?: string;
  serviceName?: string;
  barberId?: string;
  dateKey?: string;
  startTime?: string;
  status?: string;
  price?: string;
};

type HistoryEvent = {
  id: string;
  action: string;
  actorRole: "owner" | "barber" | "client";
  actorBarberId: string;
  actorLabel: string;
  createdAt: number;
  changes: Array<{
    id: string;
    type: "created" | "updated" | "deleted";
    before: AppointmentSnapshot | null;
    after: AppointmentSnapshot | null;
  }>;
};

type BackupRecord = {
  id: string;
  createdAt: number;
  source: "scheduled" | "manual";
  checksum: string;
  sizeBytes: number;
  counts: { appointments: number; clients: number; waitlistEntries: number; barbers: number };
};

const actionLabels: Record<string, string> = {
  create_client: "Klient zarezerwował wizytę",
  create_admin: "Dodano wizytę ręcznie",
  reschedule_client: "Klient poprosił o zmianę terminu",
  reschedule_admin: "Barber zmienił termin",
  confirm_client: "Klient zaakceptował zmianę",
  confirm_admin: "Barber zaakceptował zmianę",
  update_admin: "Zmieniono szczegóły wizyty",
  cancel_client: "Klient odwołał wizytę",
  cancel_admin: "Barber odwołał wizytę",
  settle_admin: "Rozliczono wizytę",
  mark_no_show_admin: "Oznaczono nieobecność",
  merge_admin_clients: "Scalono historię klienta",
  delete_admin_client: "Usunięto kartę klienta i wizyty",
};

const statusLabels: Record<string, string> = {
  confirmed: "potwierdzona",
  rescheduled: "zmiana terminu",
  cancelled: "odwołana",
  completed: "zakończona",
  no_show: "nieobecność",
};

const formatDateTime = (value: number) => new Intl.DateTimeFormat("pl-PL", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
}).format(new Date(value));

const formatAppointmentDate = (appointment?: AppointmentSnapshot | null) => {
  if (!appointment?.dateKey) return "brak terminu";
  const date = new Date(`${appointment.dateKey}T12:00:00`);
  const label = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", year: "numeric" }).format(date);
  return `${label}${appointment.startTime ? `, ${appointment.startTime}` : ""}`;
};

const roleLabel = (event: HistoryEvent) => {
  if (event.actorRole === "owner") return "Właściciel";
  if (event.actorRole === "barber") return `Barber · ${event.actorLabel || event.actorBarberId}`;
  return "Klient";
};

const authenticatedRequest = async (path: string, method: "GET" | "POST" = "GET") => {
  const user = getAuth(firebaseApp).currentUser;
  if (!user) throw new Error("Zaloguj się ponownie, aby odczytać historię.");
  const response = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  if (!response.ok) throw new Error("Nie udało się połączyć z historią zabezpieczeń.");
  return response.json();
};

export default function AppointmentHistoryPanel() {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [filter, setFilter] = useState<"all" | "barber" | "client">("all");
  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [historyResult, backupResult] = await Promise.all([
        authenticatedRequest("/api/appointment-history"),
        authenticatedRequest("/api/data-backup"),
      ]);
      setEvents(Array.isArray(historyResult.events) ? historyResult.events : []);
      setBackups(Array.isArray(backupResult.backups) ? backupResult.backups : []);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Nie udało się odczytać historii.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const visibleEvents = useMemo(() => events.filter((event) => {
    if (filter === "barber") return event.actorRole === "barber" || event.actorRole === "owner";
    if (filter === "client") return event.actorRole === "client";
    return true;
  }), [events, filter]);

  const createBackup = async () => {
    if (backingUp) return;
    setBackingUp(true);
    setError("");
    setMessage("");
    try {
      const result = await authenticatedRequest("/api/data-backup", "POST");
      setMessage(result.created ? "Utworzono bezpieczną kopię danych." : "Dzisiejsza kopia jest już gotowa.");
      const refreshed = await authenticatedRequest("/api/data-backup");
      setBackups(Array.isArray(refreshed.backups) ? refreshed.backups : []);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Nie udało się utworzyć kopii.");
    } finally {
      setBackingUp(false);
    }
  };

  const latestBackup = backups[0];

  return (
    <section className="appointment-history" aria-labelledby="appointment-history-title">
      <header className="appointment-history-heading">
        <div>
          <p className="eyebrow">OCHRONA DANYCH</p>
          <h2 id="appointment-history-title">Kopie i historia działań</h2>
          <span>Każda zmiana wizyty zachowuje stan przed i po operacji.</span>
        </div>
        <button type="button" onClick={() => void loadHistory()} disabled={loading}>
          <RefreshCw aria-hidden="true" className={loading ? "is-spinning" : ""} />
          Odśwież
        </button>
      </header>

      <div className="appointment-history-summary" aria-label="Stan zabezpieczeń">
        <article className="protected">
          <ShieldCheck aria-hidden="true" />
          <span><strong>Aktywne</strong> zapisywanie historii</span>
        </article>
        <article>
          <History aria-hidden="true" />
          <span><strong>{events.length}</strong> ostatnich działań</span>
        </article>
        <article>
          <DatabaseBackup aria-hidden="true" />
          <span>
            <strong>{latestBackup ? formatDateTime(latestBackup.createdAt) : "Jeszcze brak"}</strong>
            ostatnia kopia
          </span>
        </article>
      </div>

      <section className="backup-card" aria-labelledby="backup-card-title">
        <div>
          <p className="eyebrow">AUTOMATYCZNA KOPIA</p>
          <h3 id="backup-card-title">Codziennie, przez 14 dni</h3>
          <p>Chronimy wizyty, kartotekę klientów, listę rezerwową i ustawienia barberów.</p>
          {latestBackup ? (
            <small>
              {latestBackup.counts.appointments} wizyt · {latestBackup.counts.clients} klientów · {(latestBackup.sizeBytes / 1024).toFixed(1)} KB
            </small>
          ) : null}
        </div>
        <button type="button" onClick={() => void createBackup()} disabled={backingUp}>
          <DatabaseBackup aria-hidden="true" />
          {backingUp ? "Tworzę kopię…" : "Utwórz kopię teraz"}
        </button>
      </section>

      {message ? <p className="appointment-history-message success" role="status">{message}</p> : null}
      {error ? <p className="appointment-history-message error" role="alert">{error}</p> : null}

      <div className="appointment-history-filters" aria-label="Filtr historii">
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Wszystkie</button>
        <button type="button" className={filter === "barber" ? "active" : ""} onClick={() => setFilter("barber")}>Zespół</button>
        <button type="button" className={filter === "client" ? "active" : ""} onClick={() => setFilter("client")}>Klienci</button>
      </div>

      {loading ? (
        <div className="appointment-history-list" aria-label="Wczytywanie historii">
          {[0, 1, 2].map((item) => <article className="appointment-history-skeleton skeleton-block" key={item} />)}
        </div>
      ) : visibleEvents.length === 0 ? (
        <div className="appointment-history-empty">
          <History aria-hidden="true" />
          <h3>Historia jest gotowa</h3>
          <p>Pierwsze nowe działanie dotyczące wizyty pojawi się tutaj automatycznie.</p>
        </div>
      ) : (
        <div className="appointment-history-list">
          {visibleEvents.map((event) => (
            <article key={event.id}>
              <header>
                <span className={`appointment-history-role ${event.actorRole}`}>{roleLabel(event)}</span>
                <time dateTime={new Date(event.createdAt).toISOString()}>{formatDateTime(event.createdAt)}</time>
              </header>
              <h3>{actionLabels[event.action] ?? "Zmieniono wizytę"}</h3>
              {event.changes.map((change) => {
                const current = change.after ?? change.before;
                const moved = change.before && change.after && (
                  change.before.dateKey !== change.after.dateKey || change.before.startTime !== change.after.startTime
                );
                const statusChanged = change.before && change.after && change.before.status !== change.after.status;
                const priceChanged = change.before && change.after && change.before.price !== change.after.price;
                return (
                  <div className="appointment-history-change" key={change.id}>
                    <strong>{current?.clientName || "Klient"} · {current?.serviceName || "Wizyta"}</strong>
                    <span>{current?.barberId ? `Barber: ${current.barberId} · ` : ""}{formatAppointmentDate(current)}</span>
                    {moved ? <small>Termin: {formatAppointmentDate(change.before)} → {formatAppointmentDate(change.after)}</small> : null}
                    {statusChanged ? <small>Status: {statusLabels[change.before?.status || ""] || change.before?.status} → {statusLabels[change.after?.status || ""] || change.after?.status}</small> : null}
                    {priceChanged ? <small>Cena: {change.before?.price || "—"} → {change.after?.price || "—"}</small> : null}
                    {change.type === "deleted" ? <small>Pełny poprzedni zapis pozostaje w zabezpieczonej historii.</small> : null}
                  </div>
                );
              })}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
