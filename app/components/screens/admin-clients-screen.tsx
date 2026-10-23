"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { ChevronRight, Plus, Search, X } from "lucide-react";

import ProfileAvatar from "../profile-avatar";

type ClientFilter = "all" | "upcoming" | "rescheduled" | "missing-phone";
type AppointmentStatus = "confirmed" | "rescheduled" | "cancelled" | "completed" | "no_show";
type AppointmentColor = "blue" | "mint" | "pink" | "violet" | "amber" | "coral" | "sky" | "lime";

type AdminAppointment = {
  id: string;
  barberId: string;
  dateKey: string;
  startTime: string;
  durationMinutes: number;
  clientName: string;
  serviceName: string;
  price: string;
  color: AppointmentColor;
  status?: AppointmentStatus;
  settlement?: { barberId: string; settledAt: number; amount: number };
};

type AdminClientProfile = {
  id: string;
  userId?: string;
  name: string;
  email: string;
  phone: string;
  photoUrl: string;
  appointments: AdminAppointment[];
  nextAppointment: AdminAppointment | null;
  lastAppointment: AdminAppointment | null;
  rescheduledCount: number;
  hiddenFromDirectory: boolean;
};

// The client base only lists and finds people. Calling, texting, booking and settling
// live in the client card and in the calendar's appointment sheet, so they are not repeated here.
type AdminClientsScreenProps = {
  workspaceTabs: ReactNode;
  canManageClients: boolean;
  canManageSchedule: boolean;
  directoryClients: AdminClientProfile[];
  filteredClients: AdminClientProfile[];
  feedback: { kind: "success" | "error"; message: string } | null;
  search: string;
  filter: ClientFilter;
  currentDate: Date;
  onCreateClient: () => void;
  onSearchChange: (value: string) => void;
  onFilterChange: (filter: ClientFilter) => void;
  onOpenClient: (clientId: string) => void;
  canSettleAppointment: (appointment: AdminAppointment, currentDate: Date) => boolean;
  isPotentialNoShow: (appointment: AdminAppointment, currentDate: Date) => boolean;
};

const visitDateFormatter = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short" });
const lastVisitFormatter = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", year: "numeric" });

const filters: [ClientFilter, string][] = [
  ["all", "Wszyscy"],
  ["upcoming", "Z wizytą"],
  ["rescheduled", "Do potwierdzenia"],
  ["missing-phone", "Bez telefonu"],
];

const tones = ["blue", "mint", "pink", "violet", "amber", "coral", "sky", "lime"] as const;

const dateFromKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const getPhoneDigits = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("48") && digits.length >= 11 ? digits.slice(2, 11) : digits.slice(0, 9);
};

const formatPhoneNumber = (digits: string) =>
  [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)].filter(Boolean).join(" ");

const toneFor = (name: string) => {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return tones[hash % tones.length];
};

export default function AdminClientsScreen({
  workspaceTabs,
  canManageClients,
  canManageSchedule,
  directoryClients,
  filteredClients,
  feedback,
  search,
  filter,
  currentDate,
  onCreateClient,
  onSearchChange,
  onFilterChange,
  onOpenClient,
  canSettleAppointment,
  isPotentialNoShow,
}: AdminClientsScreenProps) {
  const duplicatePhones = useMemo(() => {
    const kinds = new Map<string, Set<boolean>>();
    for (const client of directoryClients) {
      const phone = getPhoneDigits(client.phone);
      if (phone.length !== 9) continue;
      const group = kinds.get(phone) ?? new Set<boolean>();
      group.add(Boolean(client.userId));
      kinds.set(phone, group);
    }
    return new Set([...kinds].filter(([, group]) => group.size === 2).map(([phone]) => phone));
  }, [directoryClients]);

  return (
    <div className="admin-tab-panel admin-workspace-panel active clients-base">
      {workspaceTabs}

      <div className="clients-base-scroll">
        <header className="clients-base-header">
          <div>
            <p className="eyebrow">Baza klientów</p>
            <h2>
              Klienci <span>{directoryClients.length}</span>
            </h2>
          </div>
          {canManageClients ? (
            <button className="clients-base-add" type="button" onClick={onCreateClient}>
              <Plus aria-hidden="true" />
              Dodaj
            </button>
          ) : null}
        </header>

        <label className="clients-base-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Szukaj: imię, telefon, usługa"
            aria-label="Szukaj klientów"
          />
          {search ? (
            <button type="button" onClick={() => onSearchChange("")} aria-label="Wyczyść wyszukiwanie">
              <X aria-hidden="true" />
            </button>
          ) : null}
        </label>

        <div className="clients-base-filters" role="group" aria-label="Filtry klientów">
          {filters.map(([value, label]) => (
            <button
              className={filter === value ? "active" : ""}
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => onFilterChange(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {feedback ? (
          <div className={`client-feedback ${feedback.kind}`} role="status">
            {feedback.message}
          </div>
        ) : null}

        <p className="clients-base-count" aria-live="polite">
          {filteredClients.length} {filteredClients.length === 1 ? "wynik" : "wyników"}
          {search ? ` dla „${search}”` : ""}
        </p>

        <div className="clients-base-list" key={`${filter}-${search}`}>
          {filteredClients.length > 0 ? (
            filteredClients.map((client, index) => {
              const phoneDigits = getPhoneDigits(client.phone);
              const hasPhone = phoneDigits.length === 9;
              const dueAppointment = [...client.appointments]
                .reverse()
                .find((appointment) => canSettleAppointment(appointment, currentDate));
              const status = dueAppointment
                ? isPotentialNoShow(dueAppointment, currentDate)
                  ? { tone: "alert", label: "Nierozliczona" }
                  : { tone: "alert", label: "Do rozliczenia" }
                : client.rescheduledCount > 0
                  ? { tone: "alert", label: "Do potwierdzenia" }
                  : client.nextAppointment
                    ? { tone: "active", label: "Umówiony" }
                    : client.appointments.length === 0
                      ? { tone: "new", label: "Nowy" }
                      : { tone: "idle", label: "Bez wizyty" };
              const visit = client.nextAppointment
                ? `${visitDateFormatter.format(dateFromKey(client.nextAppointment.dateKey))}, ${client.nextAppointment.startTime} · ${client.nextAppointment.serviceName}`
                : client.lastAppointment
                  ? `Ostatnio ${lastVisitFormatter.format(dateFromKey(client.lastAppointment.dateKey))}`
                  : "Brak wizyt";
              const mergeHint = canManageClients && canManageSchedule && duplicatePhones.has(phoneDigits);

              return (
                <button
                  className={`clients-base-row ${toneFor(client.name)}`}
                  key={client.id}
                  style={{ "--i": Math.min(index, 12) } as CSSProperties}
                  type="button"
                  onClick={() => onOpenClient(client.id)}
                  aria-label={`Otwórz kartę klienta ${client.name}`}
                >
                  <ProfileAvatar className="clients-base-avatar" name={client.name} photoUrl={client.photoUrl} />
                  <span className="clients-base-main">
                    <strong>{client.name}</strong>
                    <span>{visit}</span>
                    <small>
                      {hasPhone ? formatPhoneNumber(phoneDigits) : "Brak numeru telefonu"}
                      {client.appointments.length > 0 ? ` · ${client.appointments.length} wizyt` : ""}
                    </small>
                  </span>
                  <span className="clients-base-side">
                    {mergeHint ? <em className="merge">Możliwe scalenie</em> : null}
                    <em className={status.tone}>{status.label}</em>
                  </span>
                  <ChevronRight className="clients-base-chevron" aria-hidden="true" />
                </button>
              );
            })
          ) : (
            <div className="clients-base-empty">
              <strong>Brak pasujących klientów</strong>
              <span>Zmień filtr albo wyczyść wyszukiwanie.</span>
              {search || filter !== "all" ? (
                <button
                  type="button"
                  onClick={() => {
                    onSearchChange("");
                    onFilterChange("all");
                  }}
                >
                  Pokaż wszystkich
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
