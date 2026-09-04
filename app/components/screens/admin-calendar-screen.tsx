"use client";

import type { ReactNode } from "react";
import { BellRing, CalendarPlus, MessageSquare, Phone, Trash2 } from "lucide-react";

import { formatNearestAppointmentLabel } from "../../../shared/appointment-label.mjs";
import ProfileAvatar from "../profile-avatar";

type AppointmentStatus = "confirmed" | "rescheduled" | "cancelled" | "completed" | "no_show";
type AppointmentColor = "blue" | "mint" | "pink" | "violet" | "amber" | "coral" | "sky" | "lime";
type AdminWorkspaceTab = "upcoming" | "schedule" | "clients";
type WaitlistTimePreference = "any" | "morning" | "afternoon" | "evening";

type AdminAppointment = {
  id: string;
  barberId: string;
  dateKey: string;
  startTime: string;
  durationMinutes: number;
  clientName: string;
  clientPhotoUrl?: string;
  phone?: string;
  serviceName: string;
  price: string;
  color: AppointmentColor;
  status?: AppointmentStatus;
  rescheduledBy?: "client" | "admin";
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

type AvailabilityWindow = {
  id: string;
  barberId: string;
  dateKey: string;
  startTime: string;
  endTime: string;
};

type WaitlistOffer = {
  dateKey: string;
  startTime: string;
  barberId: string;
  serviceId: string;
  serviceName: string;
  price: string;
  durationMinutes: number;
  offeredAt: number;
  expiresAt: number;
};

type WaitlistEntry = {
  id: string;
  userId: string;
  clientName: string;
  clientEmail: string;
  phone: string;
  barberId: string;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  dateFrom: string;
  dateTo: string;
  timePreference: WaitlistTimePreference;
  status: "waiting" | "offered";
  offer?: WaitlistOffer | null;
  version: number;
  createdAt: number;
  updatedAt: number;
  lastOperationId?: string;
};

type UpcomingScreenProps = {
  mode: "upcoming";
  workspaceTabs: ReactNode;
  upcomingAppointments: AdminAppointment[];
  nearestAppointments: AdminAppointment[];
  clients: AdminClientProfile[];
  waitlistEntries: WaitlistEntry[];
  today: Date;
  currentDate: Date;
  canManageSchedule: boolean;
  canManageClients: boolean;
  settlingAppointmentId: string | null;
  isWaitlistSaving: boolean;
  isActionPending: (key: string) => boolean;
  onWorkspaceChange: (tab: AdminWorkspaceTab) => void;
  onSettleAppointment: (appointment: AdminAppointment) => void;
  onEditAppointment: (appointment: AdminAppointment) => void;
  onOpenClient: (clientId: string) => void;
  onOpenSms: (client: AdminClientProfile, appointment: AdminAppointment) => void;
  onCancelAppointment: (appointmentId: string) => void;
  onBookWaitlist: (entry: WaitlistEntry) => void;
  onRemoveWaitlist: (entry: WaitlistEntry) => void;
};

type CalendarScreenProps = {
  mode: "calendar";
  workspaceTabs: ReactNode;
  selectedDateKey: string;
  dayAppointments: AdminAppointment[];
  dayAvailability: AvailabilityWindow | null;
  scheduleDays: string[];
  allAppointments: AdminAppointment[];
  availability: Record<string, AvailabilityWindow>;
  scheduleSlots: string[];
  scheduleHours: string[];
  scheduleStartMinutes: number;
  today: Date;
  currentDate: Date;
  draggedAppointmentId: string | null;
  currentTimeLineVisible: boolean;
  currentTimeLineTop: number;
  currentTimeLineMinutes: number | null;
  isTouchDevice: boolean;
  onCreateAppointment: () => void;
  onShiftDay: (offset: -1 | 1) => void;
  onSelectDate: (dateKey: string) => void;
  onEditAppointment: (appointment: AdminAppointment) => void;
  onOpenWorkEditor: () => void;
  onMoveAppointment: (appointmentId: string, startTime: string) => void;
  onDragStart: (appointmentId: string) => void;
  renderAppointmentActions: (appointment: AdminAppointment, mobile?: boolean) => ReactNode;
};

type AdminCalendarScreenProps = UpcomingScreenProps | CalendarScreenProps;

const clientDateFormatter = new Intl.DateTimeFormat("pl-PL", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
});
const selectedDayFormatter = new Intl.DateTimeFormat("pl-PL", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dayFormatter = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" });
const weekdayFormatter = new Intl.DateTimeFormat("pl-PL", { weekday: "short" });
const monthFormatter = new Intl.DateTimeFormat("pl-PL", { month: "short" });

const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  confirmed: "Potwierdzona",
  rescheduled: "Przesunięta",
  cancelled: "Odwołana",
  completed: "Rozliczona",
  no_show: "Nieobecność",
};

const waitlistTimePreferenceLabels: Record<WaitlistTimePreference, string> = {
  any: "Dowolna pora",
  morning: "Rano · do 12:00",
  afternoon: "Popołudnie · 12:00–17:00",
  evening: "Wieczór · od 17:00",
};

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const dateFromKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const timeToMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

const minutesToTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const addMinutesToTime = (time: string, minutes: number) => minutesToTime(timeToMinutes(time) + minutes);

const getPhoneDigits = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("48") && digits.length >= 11 ? digits.slice(2, 11) : digits.slice(0, 9);
};

const normalizeAppointmentStatus = (status?: string): AppointmentStatus =>
  status === "rescheduled" || status === "cancelled" || status === "completed" || status === "no_show"
    ? status
    : "confirmed";

const isClosedAppointmentStatus = (status?: string) =>
  ["cancelled", "completed", "no_show"].includes(normalizeAppointmentStatus(status));

const getAppointmentDateTime = (appointment: Pick<AdminAppointment, "dateKey" | "startTime">) => {
  const date = dateFromKey(appointment.dateKey);
  const [hour, minute] = appointment.startTime.split(":").map(Number);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const getAppointmentEndDateTime = (
  appointment: Pick<AdminAppointment, "dateKey" | "startTime" | "durationMinutes">,
) => {
  const date = getAppointmentDateTime(appointment);
  date.setMinutes(date.getMinutes() + appointment.durationMinutes);
  return date;
};

const canSettleAppointment = (appointment: AdminAppointment, now: Date) => {
  if (isClosedAppointmentStatus(appointment.status)) return false;
  const settlementAvailableAt = getAppointmentDateTime(appointment);
  settlementAvailableAt.setMinutes(settlementAvailableAt.getMinutes() + 1);
  return now.getTime() >= settlementAvailableAt.getTime();
};

const isPotentialNoShow = (appointment: AdminAppointment, now: Date) =>
  !isClosedAppointmentStatus(appointment.status) &&
  now.getTime() > getAppointmentEndDateTime(appointment).getTime();

const getCalendarAppointmentState = (appointment: AdminAppointment, now: Date) => {
  const status = normalizeAppointmentStatus(appointment.status);
  if (status === "no_show") return { className: "no-show", label: "Nieobecność" };
  if (status === "completed") return { className: "completed", label: "Rozliczona" };
  if (isPotentialNoShow(appointment, now)) return { className: "missed", label: "Nierozliczona" };
  if (status === "rescheduled" && appointment.rescheduledBy !== "admin") {
    return { className: "settlement-due", label: "Do potwierdzenia" };
  }
  if (canSettleAppointment(appointment, now)) {
    return { className: "settlement-due", label: "Do rozliczenia" };
  }
  return { className: status, label: appointmentStatusLabels[status] };
};

const getAppointmentDistanceLabel = (dateKeyValue: string, today: Date) => {
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const appointmentDay = dateFromKey(dateKeyValue);
  const daysAway = Math.round((appointmentDay.getTime() - currentDay.getTime()) / 86400000);
  if (daysAway === 0) return "Dzisiaj";
  if (daysAway === 1) return "Jutro";
  if (daysAway > 1 && daysAway < 7) return `Za ${daysAway} dni`;
  return selectedDayFormatter.format(appointmentDay);
};

function UpcomingAppointmentsScreen(props: UpcomingScreenProps) {
  return (
    <div className="admin-tab-panel admin-workspace-panel nearest-workspace-panel active">
      {props.workspaceTabs}
      <div className="admin-section-header nearest-section-header">
        <div>
          <p className="eyebrow">Pierwszy rzut oka</p>
          <h2>4 najbliższe wizyty</h2>
        </div>
        <div className="admin-section-stats" aria-label="Podsumowanie najbliższych wizyt">
          <span>
            <strong>{props.upcomingAppointments.length}</strong>
            nadchodzących
          </span>
          <span>
            <strong>{props.upcomingAppointments.filter((appointment) => appointment.dateKey === dayKey(props.today)).length}</strong>
            dzisiaj
          </span>
        </div>
      </div>

      <div className="nearest-appointments-view">
        {props.nearestAppointments.length > 0 ? (
          <div className="nearest-appointments-list">
            {props.nearestAppointments.map((appointment, index) => {
              const client = props.clients.find((profile) =>
                profile.appointments.some((item) => item.id === appointment.id),
              );
              const appointmentStart = getAppointmentDateTime(appointment);
              const appointmentEnd = getAppointmentEndDateTime(appointment);
              const isInProgress =
                appointmentStart.getTime() <= props.currentDate.getTime() &&
                appointmentEnd.getTime() > props.currentDate.getTime();
              const nearestLabel =
                index === 0
                  ? formatNearestAppointmentLabel({
                      distanceLabel: getAppointmentDistanceLabel(appointment.dateKey, props.today),
                      startTime: appointment.startTime,
                      startTimestamp: appointmentStart.getTime(),
                      nowTimestamp: props.currentDate.getTime(),
                    })
                  : "";
              const settlementAvailable = canSettleAppointment(appointment, props.currentDate);
              const hasPhone = getPhoneDigits(client?.phone ?? appointment.phone ?? "").length === 9;

              return (
                <article
                  className={`nearest-appointment-card ${appointment.color} ${index === 0 ? "primary" : ""}`}
                  key={appointment.id}
                >
                  <div className={`nearest-appointment-order ${index === 0 ? "primary-label" : ""}`}>
                    {index === 0 ? (
                      <strong>{nearestLabel}</strong>
                    ) : (
                      <>
                        <span>{index + 1}</span>
                        <small>{getAppointmentDistanceLabel(appointment.dateKey, props.today)}</small>
                      </>
                    )}
                  </div>
                  <div className="nearest-appointment-time">
                    <strong>{appointment.startTime}</strong>
                    <span>do {addMinutesToTime(appointment.startTime, appointment.durationMinutes)}</span>
                  </div>
                  <ProfileAvatar
                    className="nearest-appointment-avatar"
                    name={appointment.clientName}
                    photoUrl={appointment.clientPhotoUrl}
                  />
                  <div className="nearest-appointment-main">
                    <small>{clientDateFormatter.format(dateFromKey(appointment.dateKey))}</small>
                    <h3>{appointment.clientName}</h3>
                    <span>{appointment.serviceName} · {appointment.price}</span>
                  </div>
                  <div className="nearest-appointment-state">
                    {isInProgress ? <strong>W trakcie</strong> : null}
                    <em className={`appointment-status ${normalizeAppointmentStatus(appointment.status)}`}>
                      {appointmentStatusLabels[normalizeAppointmentStatus(appointment.status)]}
                    </em>
                  </div>
                  <div className="nearest-appointment-actions">
                    {props.canManageSchedule && settlementAvailable ? (
                      <button
                        className="settle"
                        type="button"
                        disabled={Boolean(props.settlingAppointmentId)}
                        aria-busy={props.isActionPending(`settle_admin:${appointment.id}`)}
                        onClick={() => props.onSettleAppointment(appointment)}
                      >
                        {props.settlingAppointmentId === appointment.id ? "Zapisywanie..." : "Rozlicz"}
                      </button>
                    ) : null}
                    {props.canManageSchedule ? (
                      <button type="button" onClick={() => props.onEditAppointment(appointment)}>Edytuj</button>
                    ) : null}
                    {props.canManageClients && client ? (
                      <button type="button" onClick={() => props.onOpenClient(client.id)}>Karta</button>
                    ) : null}
                    {props.canManageClients && client && hasPhone ? (
                      <button className="sms" type="button" onClick={() => props.onOpenSms(client, appointment)}>SMS</button>
                    ) : null}
                    {props.canManageSchedule ? (
                      <button
                        className="cancel"
                        type="button"
                        onClick={() => props.onCancelAppointment(appointment.id)}
                        aria-label={`Odwołaj wizytę ${appointment.clientName} o ${appointment.startTime}`}
                      >
                        Odwołaj
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="nearest-appointments-empty">
            <span className="workspace-empty-icon" aria-hidden="true" />
            <strong>Brak nadchodzących wizyt</strong>
            <p>Nowe rezerwacje pojawią się tutaj automatycznie.</p>
            {props.canManageClients ? (
              <button type="button" onClick={() => props.onWorkspaceChange("clients")}>Przejdź do klientów</button>
            ) : props.canManageSchedule ? (
              <button type="button" onClick={() => props.onWorkspaceChange("schedule")}>Otwórz kalendarz</button>
            ) : null}
          </div>
        )}
      </div>

      <section className="admin-waitlist" aria-labelledby="admin-waitlist-title">
        <header>
          <span className="admin-waitlist-icon" aria-hidden="true"><BellRing /></span>
          <div>
            <p className="eyebrow">Automatyczne uzupełnianie luk</p>
            <h3 id="admin-waitlist-title">Lista rezerwowa</h3>
          </div>
          <strong>{props.waitlistEntries.length}</strong>
        </header>
        {props.waitlistEntries.length > 0 ? (
          <div className="admin-waitlist-list">
            {props.waitlistEntries.map((entry) => {
              const phoneDigits = getPhoneDigits(entry.phone);
              const offerMinutes = entry.offer
                ? Math.max(0, Math.ceil((Number(entry.offer.expiresAt) - props.currentDate.getTime()) / 60000))
                : 0;
              return (
                <article className={`admin-waitlist-row ${entry.status}`} key={entry.id}>
                  <ProfileAvatar className="admin-waitlist-avatar" name={entry.clientName} />
                  <div className="admin-waitlist-main">
                    <span>
                      <strong>{entry.clientName}</strong>
                      <em>{entry.status === "offered" ? "Oferta wysłana" : "Oczekuje"}</em>
                    </span>
                    <small>{entry.serviceName}</small>
                    <p>
                      {entry.dateFrom === entry.dateTo
                        ? clientDateFormatter.format(dateFromKey(entry.dateFrom))
                        : `${dayFormatter.format(dateFromKey(entry.dateFrom))} – ${dayFormatter.format(dateFromKey(entry.dateTo))}`}
                      {" · "}
                      {waitlistTimePreferenceLabels[entry.timePreference]}
                    </p>
                    {entry.offer ? (
                      <b>{entry.offer.dateKey}, {entry.offer.startTime} · jeszcze {offerMinutes} min</b>
                    ) : null}
                  </div>
                  <div className="admin-waitlist-actions">
                    {props.canManageSchedule ? (
                      <button
                        className="admin-waitlist-book"
                        type="button"
                        onClick={() => props.onBookWaitlist(entry)}
                        aria-label={`Umów wizytę dla ${entry.clientName}`}
                      >
                        <CalendarPlus aria-hidden="true" />
                        <span>Umów</span>
                      </button>
                    ) : null}
                    {phoneDigits.length === 9 ? (
                      <>
                        <a href={`tel:+48${phoneDigits}`} aria-label={`Zadzwoń do ${entry.clientName}`}><Phone aria-hidden="true" /></a>
                        <a href={`sms:+48${phoneDigits}`} aria-label={`Napisz SMS do ${entry.clientName}`}><MessageSquare aria-hidden="true" /></a>
                      </>
                    ) : null}
                    <button
                      type="button"
                      disabled={props.isWaitlistSaving}
                      aria-busy={props.isActionPending(`remove_waitlist_admin:${entry.id}`)}
                      onClick={() => props.onRemoveWaitlist(entry)}
                      aria-label={`Usuń ${entry.clientName} z listy rezerwowej`}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="admin-waitlist-empty">
            <strong>Nikt teraz nie oczekuje</strong>
            <span>Nowe zgłoszenia klientów pojawią się tutaj automatycznie.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function ScheduleCalendarScreen(props: CalendarScreenProps) {
  return (
    <div className="admin-tab-panel admin-workspace-panel active">
      {props.workspaceTabs}
      <div className="admin-section-header schedule-section-header">
        <div className="schedule-heading-main">
          <p className="eyebrow">Wybrany dzień</p>
          <h2>{clientDateFormatter.format(dateFromKey(props.selectedDateKey))}</h2>
          <button className="schedule-add-appointment" type="button" onClick={props.onCreateAppointment}>
            <span aria-hidden="true">+</span>
            Dodaj wizytę
          </button>
        </div>
        <div className="admin-section-stats" aria-label="Podsumowanie dnia">
          <span><strong>{props.dayAppointments.length}</strong>wizyty</span>
          <span>
            <strong>
              {props.dayAvailability
                ? `${props.dayAvailability.startTime}-${props.dayAvailability.endTime}`
                : "brak"}
            </strong>
            dostępność
          </span>
        </div>
        <div className="schedule-date-controls" aria-label="Zmień dzień terminarza">
          <button type="button" onClick={() => props.onShiftDay(-1)} aria-label="Poprzedni dzień">‹</button>
          <label>
            <span>Data</span>
            <input type="date" value={props.selectedDateKey} onChange={(event) => props.onSelectDate(event.target.value)} />
          </label>
          <button
            className={props.selectedDateKey === dayKey(props.today) ? "today active" : "today"}
            type="button"
            onClick={() => props.onSelectDate(dayKey(props.today))}
          >
            Dzisiaj
          </button>
          <button type="button" onClick={() => props.onShiftDay(1)} aria-label="Następny dzień">›</button>
        </div>
      </div>

      <div className="schedule-desktop-grid">
        <aside className="schedule-side-panel">
          <div className="admin-days" aria-label="Dni z wizytami">
            {props.scheduleDays.length > 0 ? (
              props.scheduleDays.map((key) => {
                const date = dateFromKey(key);
                const appointmentsCount = props.allAppointments.filter((appointment) => appointment.dateKey === key).length;
                const dayAvailability = props.availability[key] ?? null;
                return (
                  <button
                    className={`${key === props.selectedDateKey ? "active" : ""} ${appointmentsCount > 0 ? "has-appointments" : ""}`}
                    key={key}
                    type="button"
                    onClick={() => props.onSelectDate(key)}
                    aria-label={`${clientDateFormatter.format(date)}, ${appointmentsCount} wizyt, ${
                      dayAvailability
                        ? `dostępność ${dayAvailability.startTime}-${dayAvailability.endTime}`
                        : "brak dostępności"
                    }`}
                  >
                    <span>{weekdayFormatter.format(date).replace(".", "")}</span>
                    <strong>{String(date.getDate()).padStart(2, "0")}</strong>
                    <small>
                      {monthFormatter.format(date).replace(".", "")}
                      {appointmentsCount > 0 ? ` · ${appointmentsCount}` : ""}
                    </small>
                  </button>
                );
              })
            ) : (
              <p className="admin-days-empty">Brak zaplanowanych wizyt.</p>
            )}
          </div>

          <div className="client-strip" aria-label="Klienci z wybranego dnia">
            {props.dayAppointments.length > 0 ? (
              props.dayAppointments.map((appointment) => (
                <button
                  className="client-chip"
                  key={appointment.id}
                  type="button"
                  onClick={() => props.onEditAppointment(appointment)}
                  aria-label={`Edytuj wizytę ${appointment.clientName} o ${appointment.startTime}`}
                >
                  <span>{appointment.clientName.slice(0, 1)}</span>
                  <strong>{appointment.clientName}</strong>
                  <small>{appointment.startTime}</small>
                </button>
              ))
            ) : (
              <p>Brak klientów w tym dniu.</p>
            )}
          </div>
        </aside>

        <section className="schedule-mobile-agenda" aria-label="Plan wybranego dnia">
          <div className={`mobile-availability-banner ${props.dayAvailability ? "open" : "closed"}`}>
            <span aria-hidden="true" />
            <div>
              <strong>{props.dayAvailability ? "Dzień otwarty" : "Brak dostępności"}</strong>
              <small>
                {props.dayAvailability
                  ? `${props.dayAvailability.startTime}-${props.dayAvailability.endTime} dla klientów`
                  : "Klienci nie mogą rezerwować tego dnia"}
              </small>
            </div>
            <button type="button" onClick={props.onOpenWorkEditor}>{props.dayAvailability ? "Zmień" : "Ustaw"}</button>
          </div>

          <div className="mobile-agenda-heading">
            <div>
              <p className="section-label">Plan dnia</p>
              <strong>
                {props.dayAppointments.length === 0
                  ? "Spokojny dzień"
                  : `${props.dayAppointments.length} ${props.dayAppointments.length === 1 ? "wizyta" : "wizyty"}`}
              </strong>
            </div>
            <span>{getAppointmentDistanceLabel(props.selectedDateKey, props.today)}</span>
          </div>

          <div className="mobile-agenda-list">
            {props.dayAppointments.length > 0 ? (
              props.dayAppointments.map((appointment) => {
                const calendarState = getCalendarAppointmentState(appointment, props.currentDate);
                return (
                  <article className={`mobile-agenda-appointment ${appointment.color}`} key={appointment.id}>
                    <div className="mobile-agenda-time">
                      <strong>{appointment.startTime}</strong>
                      <span>{addMinutesToTime(appointment.startTime, appointment.durationMinutes)}</span>
                    </div>
                    <div className="mobile-agenda-client">
                      <strong>{appointment.clientName}</strong>
                      <span>{appointment.serviceName}</span>
                      <small>{appointment.price}</small>
                    </div>
                    <em className={`appointment-status ${calendarState.className}`}>{calendarState.label}</em>
                    {props.renderAppointmentActions(appointment, true)}
                  </article>
                );
              })
            ) : (
              <div className="mobile-agenda-empty">
                <strong>Nie ma tu jeszcze żadnej wizyty</strong>
                <span>
                  {props.dayAvailability
                    ? "Wolne okno jest widoczne dla klientów."
                    : "Ustaw dostępność, jeśli chcesz przyjmować rezerwacje."}
                </span>
              </div>
            )}
          </div>
        </section>

        <div className="admin-schedule" style={{ height: `${Math.max(8, props.scheduleSlots.length) * 2.8 + 1.5}rem` }}>
          {props.dayAppointments.length === 0 ? <p className="admin-empty-state">Brak wizyt w tym dniu.</p> : null}
          <div
            className="time-axis"
            aria-hidden="true"
            style={{ gridTemplateRows: `repeat(${props.scheduleHours.length}, 11.2rem)` }}
          >
            {props.scheduleHours.map((time) => <span key={time}>{time}</span>)}
          </div>

          <div className="schedule-column">
            {props.scheduleSlots.map((time) => (
              <div
                className="schedule-drop-zone"
                key={time}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (props.draggedAppointmentId) props.onMoveAppointment(props.draggedAppointmentId, time);
                }}
              />
            ))}

            {props.currentTimeLineVisible ? (
              <div
                className="current-time-line"
                style={{ top: `${props.currentTimeLineTop}rem` }}
                aria-label={`Aktualna godzina ${minutesToTime(props.currentTimeLineMinutes ?? 0)}`}
              >
                <span>{minutesToTime(props.currentTimeLineMinutes ?? 0)}</span>
              </div>
            ) : null}

            {props.dayAppointments.map((appointment) => {
              const top = ((timeToMinutes(appointment.startTime) - props.scheduleStartMinutes) / 15) * 2.8;
              const height = Math.max(4.8, (appointment.durationMinutes / 15) * 2.8 - 0.35);
              const calendarState = getCalendarAppointmentState(appointment, props.currentDate);
              const appointmentIsEditable =
                !isClosedAppointmentStatus(appointment.status) && !isPotentialNoShow(appointment, props.currentDate);

              return (
                <article
                  className={`admin-appointment ${appointment.color}`}
                  draggable={!props.isTouchDevice && appointmentIsEditable}
                  key={appointment.id}
                  onDragStart={() => {
                    if (appointmentIsEditable) props.onDragStart(appointment.id);
                  }}
                  style={{ top: `${top}rem`, height: `${height}rem` }}
                >
                  <div>
                    <strong>
                      {appointment.startTime} - {addMinutesToTime(appointment.startTime, appointment.durationMinutes)}
                    </strong>
                    <span>{appointment.clientName} · {appointment.serviceName}</span>
                    <small className={`appointment-status ${calendarState.className}`}>{calendarState.label}</small>
                  </div>
                  {props.renderAppointmentActions(appointment)}
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminCalendarScreen(props: AdminCalendarScreenProps) {
  return props.mode === "upcoming" ? <UpcomingAppointmentsScreen {...props} /> : <ScheduleCalendarScreen {...props} />;
}
