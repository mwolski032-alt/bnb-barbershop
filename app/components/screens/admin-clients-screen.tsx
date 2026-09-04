"use client";

import type { ReactNode } from "react";
import { Calendar, Mail, MessageSquare, Phone, Users } from "lucide-react";

import ProfileAvatar from "../profile-avatar";

type ClientWorkspaceTab = "appointments" | "directory";
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

type AdminClientsScreenProps = {
  workspaceTabs: ReactNode;
  workspaceTab: ClientWorkspaceTab;
  canManageClients: boolean;
  canManageSchedule: boolean;
  activeClients: AdminClientProfile[];
  directoryClients: AdminClientProfile[];
  filteredClients: AdminClientProfile[];
  feedback: { kind: "success" | "error"; message: string } | null;
  search: string;
  filter: ClientFilter;
  currentDate: Date;
  settlingAppointmentId: string | null;
  onCreateClient: () => void;
  onWorkspaceChange: (tab: ClientWorkspaceTab) => void;
  onSearchChange: (value: string) => void;
  onFilterChange: (filter: ClientFilter) => void;
  onOpenClient: (clientId: string) => void;
  onSettleAppointment: (appointment: AdminAppointment) => void;
  onBookClient: (client: AdminClientProfile) => void;
  onOpenSms: (client: AdminClientProfile, appointment: AdminAppointment) => void;
  canSettleAppointment: (appointment: AdminAppointment, currentDate: Date) => boolean;
  isPotentialNoShow: (appointment: AdminAppointment, currentDate: Date) => boolean;
  isActionPending: (key: string) => boolean;
};

const clientDateFormatter = new Intl.DateTimeFormat("pl-PL", {
  weekday: "short",
  day: "2-digit",
  month: "short",
});

const dateFromKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const getPhoneDigits = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("48") && digits.length >= 11 ? digits.slice(2, 11) : digits.slice(0, 9);
};

const formatPhoneNumber = (value: string) => {
  const digits = getPhoneDigits(value);
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)]
    .filter(Boolean)
    .join(" ");
};

export default function AdminClientsScreen({
  workspaceTabs,
  workspaceTab,
  canManageClients,
  canManageSchedule,
  activeClients,
  directoryClients,
  filteredClients,
  feedback,
  search,
  filter,
  currentDate,
  settlingAppointmentId,
  onCreateClient,
  onWorkspaceChange,
  onSearchChange,
  onFilterChange,
  onOpenClient,
  onSettleAppointment,
  onBookClient,
  onOpenSms,
  canSettleAppointment,
  isPotentialNoShow,
  isActionPending,
}: AdminClientsScreenProps) {
  return (
    <div className="admin-tab-panel admin-workspace-panel active">
      {workspaceTabs}
      <div className="admin-section-header">
        <div className="client-section-title">
          <div>
            <p className="eyebrow">
              {workspaceTab === "appointments" ? "Bieżąca obsługa" : "Kartoteka kontaktów"}
            </p>
            <h2>{workspaceTab === "appointments" ? "Aktywne wizyty" : "Klienci"}</h2>
          </div>
          {canManageClients ? (
            <button className="add-client-button" type="button" onClick={onCreateClient}>
              <span aria-hidden="true">+</span>
              Dodaj klienta
            </button>
          ) : null}
        </div>
        <div className="admin-section-stats" aria-label="Podsumowanie klientów">
          <span>
            <strong>{workspaceTab === "appointments" ? activeClients.length : directoryClients.length}</strong>
            {workspaceTab === "appointments" ? "aktywnych" : "klientów"}
          </span>
          <span>
            <strong>
              {workspaceTab === "appointments"
                ? activeClients.filter((client) => client.rescheduledCount > 0).length
                : directoryClients.filter((client) => !client.nextAppointment).length}
            </strong>
            {workspaceTab === "appointments" ? "do potwierdzenia" : "bez wizyty"}
          </span>
        </div>
      </div>

      <div className="clients-view" aria-label="Lista klientów">
        <div className="client-workspace-tabs" role="tablist" aria-label="Widok bazy klientów">
          <button
            className={workspaceTab === "appointments" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={workspaceTab === "appointments"}
            onClick={() => onWorkspaceChange("appointments")}
          >
            <Calendar className="client-workspace-tab-icon appointments" aria-hidden="true" strokeWidth={2.1} />
            Aktywne wizyty
            <small>{activeClients.length}</small>
          </button>
          <button
            className={workspaceTab === "directory" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={workspaceTab === "directory"}
            onClick={() => onWorkspaceChange("directory")}
          >
            <Users className="client-workspace-tab-icon directory" aria-hidden="true" strokeWidth={2.1} />
            Klienci
            <small>{directoryClients.length}</small>
          </button>
        </div>

        {feedback ? (
          <div className={`client-feedback ${feedback.kind}`} role="status">
            {feedback.message}
          </div>
        ) : null}

        <div className="client-directory-tools">
          <label className="client-search">
            <span className="client-search-icon" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Szukaj po nazwisku, telefonie lub usłudze"
              aria-label="Szukaj klientów"
            />
            {search ? (
              <button type="button" onClick={() => onSearchChange("")} aria-label="Wyczyść wyszukiwanie">
                ×
              </button>
            ) : null}
          </label>
          <div className="client-filters" aria-label="Filtry klientów">
            {(
              (workspaceTab === "appointments"
                ? [
                    ["all", "Wszystkie"],
                    ["upcoming", "Nadchodzące"],
                    ["rescheduled", "Do potwierdzenia"],
                  ]
                : [
                    ["all", "Wszyscy"],
                    ["upcoming", "Z terminem"],
                    ["missing-phone", "Brak telefonu"],
                  ]) as [ClientFilter, string][]
            ).map(([filterValue, label]) => (
              <button
                className={filter === filterValue ? "active" : ""}
                key={filterValue}
                type="button"
                onClick={() => onFilterChange(filterValue)}
                aria-pressed={filter === filterValue}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="client-directory-summary" aria-live="polite">
          <strong>{filteredClients.length}</strong>
          <span>
            {filteredClients.length === 1 ? "wynik" : "wyników"}
            {search ? ` dla „${search}”` : ""}
          </span>
        </div>

        <div className="client-directory-list">
          {filteredClients.length > 0 ? (
            filteredClients.map((client) => {
              const phoneDigits = getPhoneDigits(client.phone);
              const hasPhone = phoneDigits.length === 9;
              const contactAppointment = client.nextAppointment ?? client.appointments.at(-1) ?? null;
              const settlementAppointment = [...client.appointments]
                .reverse()
                .find((appointment) => canSettleAppointment(appointment, currentDate));

              return (
                <article className="client-row" key={client.id}>
                  <button
                    className="client-profile-trigger"
                    type="button"
                    onClick={() => onOpenClient(client.id)}
                    aria-label={`Otwórz kartę klienta ${client.name}`}
                  >
                    <ProfileAvatar className="client-row-avatar" name={client.name} photoUrl={client.photoUrl} />
                    <span className="client-row-main">
                      <span className="client-row-name">
                        <strong>{client.name}</strong>
                        <small>{client.appointments.length} wizyt</small>
                      </span>
                      {client.nextAppointment ? (
                        <span>
                          {clientDateFormatter.format(dateFromKey(client.nextAppointment.dateKey))},{" "}
                          {client.nextAppointment.startTime} · {client.nextAppointment.serviceName}
                        </span>
                      ) : (
                        <span>Brak kolejnej wizyty</span>
                      )}
                      <small>
                        {hasPhone ? formatPhoneNumber(phoneDigits) : "Brak numeru telefonu"}
                        {client.email ? ` · ${client.email}` : ""}
                      </small>
                    </span>
                    <span className="client-row-statuses">
                      {settlementAppointment ? (
                        <em
                          className={`appointment-status ${
                            isPotentialNoShow(settlementAppointment, currentDate) ? "missed" : "settlement-due"
                          }`}
                        >
                          {isPotentialNoShow(settlementAppointment, currentDate) ? "Nierozliczona" : "Do rozliczenia"}
                        </em>
                      ) : client.rescheduledCount > 0 ? (
                        <em className="appointment-status rescheduled">Do potwierdzenia</em>
                      ) : client.nextAppointment ? (
                        <em className="appointment-status">Aktywny</em>
                      ) : client.appointments.length === 0 ? (
                        <em className="client-history-status">Nowy klient</em>
                      ) : (
                        <em className="client-history-status">Historia</em>
                      )}
                      <i aria-hidden="true">›</i>
                    </span>
                  </button>

                  <div className="client-quick-actions" aria-label={`Szybkie akcje dla ${client.name}`}>
                    {canManageSchedule && settlementAppointment ? (
                      <button
                        className="settle-appointment-button"
                        type="button"
                        disabled={Boolean(settlingAppointmentId)}
                        aria-busy={isActionPending(`settle_admin:${settlementAppointment.id}`)}
                        onClick={() => onSettleAppointment(settlementAppointment)}
                      >
                        {settlingAppointmentId === settlementAppointment.id ? "Zapisywanie..." : "Rozlicz"}
                      </button>
                    ) : null}
                    {canManageSchedule ? (
                      <button
                        className="book-client-button"
                        type="button"
                        onClick={() => onBookClient(client)}
                        aria-label={`Umów wizytę dla ${client.name}`}
                        title="Umów wizytę"
                      >
                        <Calendar className="small-calendar-icon" aria-hidden="true" strokeWidth={2.1} />
                      </button>
                    ) : null}
                    {hasPhone ? (
                      <a
                        className="client-phone-button"
                        href={`tel:+48${phoneDigits}`}
                        aria-label={`Zadzwoń do ${client.name}`}
                        title="Zadzwoń"
                      >
                        <Phone className="phone-icon" aria-hidden="true" strokeWidth={2.1} />
                      </a>
                    ) : (
                      <span className="client-phone-button disabled" aria-label="Brak numeru telefonu">
                        <Phone className="phone-icon" aria-hidden="true" strokeWidth={2.1} />
                      </span>
                    )}
                    {contactAppointment ? (
                      <button
                        className="sms-button"
                        type="button"
                        disabled={!hasPhone}
                        onClick={() => onOpenSms(client, contactAppointment)}
                        aria-label={hasPhone ? `Napisz SMS do ${client.name}` : "Brak numeru telefonu"}
                      >
                        <MessageSquare className="sms-icon" aria-hidden="true" strokeWidth={2.1} />
                      </button>
                    ) : hasPhone ? (
                      <a className="sms-button" href={`sms:+48${phoneDigits}`} aria-label={`Napisz SMS do ${client.name}`}>
                        <MessageSquare className="sms-icon" aria-hidden="true" strokeWidth={2.1} />
                      </a>
                    ) : (
                      <span className="sms-button disabled" aria-label="Brak numeru telefonu">
                        <MessageSquare className="sms-icon" aria-hidden="true" strokeWidth={2.1} />
                      </span>
                    )}
                    {client.email ? (
                      <a
                        className="client-email-button"
                        href={`mailto:${client.email}?subject=${encodeURIComponent("BNB Barbershop - Twoja wizyta")}`}
                        aria-label={`Napisz e-mail do ${client.name}`}
                      >
                        <Mail className="email-icon" aria-hidden="true" strokeWidth={2.1} />
                      </a>
                    ) : (
                      <span className="client-email-button disabled" aria-label="Brak adresu e-mail">
                        <Mail className="email-icon" aria-hidden="true" strokeWidth={2.1} />
                      </span>
                    )}
                    <button
                      className="client-card-button"
                      type="button"
                      onClick={() => onOpenClient(client.id)}
                      aria-label={`Otwórz kartę klienta ${client.name}`}
                    >
                      Karta
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="clients-empty-state">
              <strong>{workspaceTab === "appointments" ? "Brak aktywnych wizyt" : "Brak pasujących klientów"}</strong>
              <span>
                {workspaceTab === "appointments"
                  ? "Klienci z nadchodzącym terminem lub wizytą do rozliczenia pojawią się tutaj."
                  : "Zmień filtr albo wyczyść wyszukiwanie."}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
