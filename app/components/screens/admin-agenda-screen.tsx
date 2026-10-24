"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  BellRing,
  CalendarPlus,
  Check,
  Clock,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Trash2,
  User,
  X,
} from "lucide-react";

import { formatNearestAppointmentLabel } from "../../../shared/appointment-label.mjs";
import type {
  AdminAppointment,
  AdminClientProfile,
  AvailabilityWindow,
  WaitlistEntry,
} from "../../lib/booking-types";
import {
  canSettleAppointment,
  dateFromKey,
  dayKey,
  getAppointmentDateTime,
  getAppointmentEndDateTime,
  getPhoneDigits,
  isClosedAppointmentStatus,
  isPotentialNoShow,
  minutesToTime,
  normalizeAppointmentStatus,
  timeToMinutes,
} from "../../lib/booking-selectors";
import ProfileAvatar from "../profile-avatar";
import WaitlistDetailDialog from "../waitlist-detail-dialog";

export type AgendaScreenProps = {
  mode: "agenda";
  workspaceTabs: ReactNode;
  selectedDateKey: string;
  dayAppointments: AdminAppointment[];
  dayAvailability: AvailabilityWindow | null;
  scheduleDays: string[];
  allAppointments: AdminAppointment[];
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
  onSelectDate: (dateKey: string) => void;
  onCreateAppointment: () => void;
  onOpenWorkEditor: () => void;
  onSettleAppointment: (appointment: AdminAppointment) => void;
  onEditAppointment: (appointment: AdminAppointment) => void;
  onOpenClient: (clientId: string) => void;
  onOpenSms: (client: AdminClientProfile, appointment: AdminAppointment) => void;
  onCancelAppointment: (appointmentId: string) => void;
  /** The client moved the visit: the barber confirms the new term... */
  onConfirmAppointment: (appointment: AdminAppointment) => void;
  /** ...or refuses it, which puts the visit back at its old term. */
  onRefuseAppointment: (appointment: AdminAppointment) => void;
  onBookWaitlist: (entry: WaitlistEntry, dateKey?: string) => void;
  onRemoveWaitlist: (entry: WaitlistEntry) => void;
};

const longDayFormatter = new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long" });
const shortDayFormatter = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short" });
const weekdayFormatter = new Intl.DateTimeFormat("pl-PL", { weekday: "short" });
const monthFormatter = new Intl.DateTimeFormat("pl-PL", { month: "short" });

const statusLabels = {
  confirmed: "Umówiona",
  rescheduled: "Przesunięta",
  cancelled: "Odwołana",
  completed: "Rozliczona",
  no_show: "Nieobecność",
} as const;

const minutesFromMidnight = (date: Date) => date.getHours() * 60 + date.getMinutes();

const getDistanceLabel = (key: string, today: Date) => {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((dateFromKey(key).getTime() - start.getTime()) / 86400000);
  if (days === 0) return "Dzisiaj";
  if (days === 1) return "Jutro";
  if (days === -1) return "Wczoraj";
  return null;
};

const getTileState = (appointment: AdminAppointment, now: Date) => {
  const status = normalizeAppointmentStatus(appointment.status);
  if (status === "completed") return { key: "done", label: statusLabels.completed };
  if (status === "no_show") return { key: "done", label: statusLabels.no_show };
  if (isPotentialNoShow(appointment, now)) return { key: "alert", label: "Nierozliczona" };
  if (status === "rescheduled" && appointment.rescheduledBy !== "admin") {
    return { key: "alert", label: "Do potwierdzenia" };
  }
  const start = getAppointmentDateTime(appointment).getTime();
  const end = getAppointmentEndDateTime(appointment).getTime();
  if (start <= now.getTime() && end > now.getTime()) return { key: "live", label: "W trakcie" };
  if (canSettleAppointment(appointment, now)) return { key: "alert", label: "Do rozliczenia" };
  // The client answered the reminder with "I'll be there".
  if (status === "confirmed" && appointment.attendanceConfirmedAt) return { key: "idle", label: "Klient potwierdził" };
  return { key: "idle", label: statusLabels[status] };
};

export default function AdminAgendaScreen(props: AgendaScreenProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistDetailId, setWaitlistDetailId] = useState<string | null>(null);
  const waitlistDetail = props.waitlistEntries.find((entry) => entry.id === waitlistDetailId) ?? null;
  const dayStripRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  const selectedAppointment = useMemo(
    () => props.allAppointments.find((item) => item.id === (openId ?? leavingId)) ?? null,
    [props.allAppointments, openId, leavingId],
  );
  const selectedClient = selectedAppointment
    ? props.clients.find((profile) => profile.appointments.some((item) => item.id === selectedAppointment.id)) ?? null
    : null;

  const closeSheet = () => {
    if (!openId) return;
    setLeavingId(openId);
    setOpenId(null);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setLeavingId(null), 220);
  };

  useEffect(() => {
    if (!openId) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // closeSheet only reads openId, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    const active = dayStripRef.current?.querySelector<HTMLElement>("[aria-current='date']");
    active?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [props.selectedDateKey]);

  const todayKey = dayKey(props.today);
  const dayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const appointment of props.allAppointments) {
      if (isClosedAppointmentStatus(appointment.status) && appointment.dateKey < todayKey) continue;
      counts.set(appointment.dateKey, (counts.get(appointment.dateKey) ?? 0) + 1);
    }
    return counts;
  }, [props.allAppointments, todayKey]);

  const nextAppointment = props.nearestAppointments[0] ?? null;
  const nextStartsAt = nextAppointment ? getAppointmentDateTime(nextAppointment).getTime() : 0;
  const nextLabel = !nextAppointment
    ? ""
    : nextStartsAt <= props.currentDate.getTime()
      ? "Teraz"
      : formatNearestAppointmentLabel({
        distanceLabel:
          getDistanceLabel(nextAppointment.dateKey, props.today) ??
          shortDayFormatter.format(dateFromKey(nextAppointment.dateKey)),
        startTime: nextAppointment.startTime,
        startTimestamp: getAppointmentDateTime(nextAppointment).getTime(),
        nowTimestamp: props.currentDate.getTime(),
      });

  const dayList = useMemo(() => {
    type Row = { kind: "visit"; appointment: AdminAppointment } | { kind: "gap"; from: number; to: number };
    const rows: Row[] = [];
    let cursor = props.dayAvailability ? timeToMinutes(props.dayAvailability.startTime) : null;
    const endOfDay = props.dayAvailability ? timeToMinutes(props.dayAvailability.endTime) : null;
    for (const appointment of props.dayAppointments) {
      const start = timeToMinutes(appointment.startTime);
      if (cursor !== null && start - cursor >= 30) rows.push({ kind: "gap", from: cursor, to: start });
      rows.push({ kind: "visit", appointment });
      cursor = Math.max(cursor ?? 0, start + appointment.durationMinutes);
    }
    if (cursor !== null && endOfDay !== null && endOfDay - cursor >= 30) {
      rows.push({ kind: "gap", from: cursor, to: endOfDay });
    }
    return rows;
  }, [props.dayAppointments, props.dayAvailability]);

  const isToday = props.selectedDateKey === todayKey;
  const nowMinutes = minutesFromMidnight(props.currentDate);
  const distance = getDistanceLabel(props.selectedDateKey, props.today);
  const visitCount = props.dayAppointments.length;
  const openCount = props.dayAppointments.filter((item) => !isClosedAppointmentStatus(item.status)).length;

  const runAndClose = (action: () => void) => {
    closeSheet();
    action();
  };

  const sheetOpen = Boolean(selectedAppointment);
  const sheetState = selectedAppointment ? getTileState(selectedAppointment, props.currentDate) : null;
  const phoneDigits = getPhoneDigits(selectedClient?.phone ?? selectedAppointment?.phone ?? "");
  const hasPhone = phoneDigits.length === 9;
  const canSettle = selectedAppointment ? canSettleAppointment(selectedAppointment, props.currentDate) : false;
  const canEdit = selectedAppointment ? !isClosedAppointmentStatus(selectedAppointment.status) : false;
  const isCompleted = selectedAppointment ? normalizeAppointmentStatus(selectedAppointment.status) === "completed" : false;
  const awaitsBarber = selectedAppointment
    ? normalizeAppointmentStatus(selectedAppointment.status) === "rescheduled" && selectedAppointment.rescheduledBy !== "admin"
    : false;
  const canRefuse = Boolean(awaitsBarber && selectedAppointment?.previousDateKey);

  return (
    <div className="admin-tab-panel admin-workspace-panel active agenda-panel">
      {props.workspaceTabs}

      <div className="agenda-scroll">
        <header className="agenda-header">
          <div>
            <p className="eyebrow">{distance ?? "Wybrany dzień"}</p>
            <h2>{longDayFormatter.format(dateFromKey(props.selectedDateKey))}</h2>
            <small>
              {visitCount === 0
                ? "Brak wizyt"
                : `${visitCount} ${visitCount === 1 ? "wizyta" : "wizyty"}${openCount !== visitCount ? ` · ${openCount} do końca` : ""}`}
              {props.dayAvailability ? ` · ${props.dayAvailability.startTime}–${props.dayAvailability.endTime}` : ""}
            </small>
          </div>
          <div className="agenda-header-actions">
            {props.waitlistEntries.length > 0 || waitlistOpen ? (
              <button
                className={`agenda-icon-button ${waitlistOpen ? "active" : ""}`}
                type="button"
                aria-pressed={waitlistOpen}
                aria-label={`Lista rezerwowa: ${props.waitlistEntries.length}`}
                onClick={() => setWaitlistOpen((open) => !open)}
              >
                <BellRing aria-hidden="true" />
                {props.waitlistEntries.length > 0 ? <b>{props.waitlistEntries.length}</b> : null}
              </button>
            ) : null}
          </div>
        </header>

        {nextAppointment ? (
          <button
            className={`agenda-next ${nextAppointment.color}`}
            type="button"
            onClick={() => {
              props.onSelectDate(nextAppointment.dateKey);
              setOpenId(nextAppointment.id);
            }}
          >
            <span className="agenda-next-icon" aria-hidden="true"><Clock /></span>
            <span className="agenda-next-text">
              <small>Następny klient</small>
              <strong>{nextAppointment.clientName}</strong>
            </span>
            <em>{nextLabel}</em>
          </button>
        ) : null}

        <div className="agenda-days" ref={dayStripRef} aria-label="Wybierz dzień">
          {props.scheduleDays.map((key) => {
            const date = dateFromKey(key);
            const count = dayCounts.get(key) ?? 0;
            const selected = key === props.selectedDateKey;
            return (
              <button
                className={`${selected ? "active" : ""} ${key === todayKey ? "today" : ""} ${count > 0 ? "busy" : ""}`}
                key={key}
                type="button"
                aria-current={selected ? "date" : undefined}
                aria-label={`${shortDayFormatter.format(date)}, wizyt: ${count}`}
                onClick={() => props.onSelectDate(key)}
              >
                <span>{weekdayFormatter.format(date).replace(".", "")}</span>
                <strong>{date.getDate()}</strong>
                <small>{count > 0 ? count : monthFormatter.format(date).replace(".", "")}</small>
              </button>
            );
          })}
        </div>

        {waitlistOpen ? (
          <section className="agenda-waitlist" aria-label="Lista rezerwowa">
            {props.waitlistEntries.length === 0 ? (
              <p className="agenda-waitlist-empty">Nikt teraz nie czeka na wolny termin.</p>
            ) : (
              props.waitlistEntries.map((entry) => {
                const digits = getPhoneDigits(entry.phone);
                return (
                  <article className="agenda-waitlist-row" key={entry.id}>
                    <ProfileAvatar className="agenda-waitlist-avatar" name={entry.clientName} />
                    <div
                      className="agenda-waitlist-open"
                      role="button"
                      tabIndex={0}
                      aria-label={`Szczegóły: ${entry.clientName}`}
                      onClick={() => setWaitlistDetailId(entry.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setWaitlistDetailId(entry.id);
                        }
                      }}
                    >
                      <strong>{entry.clientName}</strong>
                      <small>
                        {entry.serviceName} ·{" "}
                        {entry.dateFrom === entry.dateTo
                          ? shortDayFormatter.format(dateFromKey(entry.dateFrom))
                          : `${shortDayFormatter.format(dateFromKey(entry.dateFrom))} – ${shortDayFormatter.format(dateFromKey(entry.dateTo))}`}
                        {entry.status === "offered" ? " · oferta wysłana" : ""}
                      </small>
                    </div>
                    <span className="agenda-waitlist-actions">
                      {props.canManageSchedule ? (
                        <button type="button" aria-label={`Umów ${entry.clientName}`} onClick={() => props.onBookWaitlist(entry)}>
                          <CalendarPlus aria-hidden="true" />
                        </button>
                      ) : null}
                      {digits.length === 9 ? (
                        <a href={`tel:+48${digits}`} aria-label={`Zadzwoń do ${entry.clientName}`}><Phone aria-hidden="true" /></a>
                      ) : null}
                      <button
                        type="button"
                        disabled={props.isWaitlistSaving}
                        aria-busy={props.isActionPending(`remove_waitlist_admin:${entry.id}`)}
                        aria-label={`Usuń ${entry.clientName} z listy`}
                        onClick={() => props.onRemoveWaitlist(entry)}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </span>
                  </article>
                );
              })
            )}
          </section>
        ) : null}

        {waitlistDetail ? (
          <WaitlistDetailDialog
            entry={waitlistDetail}
            today={props.currentDate}
            canManageSchedule={props.canManageSchedule}
            removing={props.isWaitlistSaving}
            onBook={(entry, dateKey) => {
              setWaitlistDetailId(null);
              props.onBookWaitlist(entry, dateKey);
            }}
            onRemove={props.onRemoveWaitlist}
            onClose={() => setWaitlistDetailId(null)}
          />
        ) : null}

        <div className="agenda-list" key={props.selectedDateKey}>
          {!props.dayAvailability && visitCount === 0 ? (
            <div className="agenda-empty">
              <strong>Dzień bez dostępności</strong>
              <span>Klienci nie mogą tu rezerwować. Ustaw godziny pracy, jeśli chcesz przyjmować wizyty.</span>
              <button type="button" onClick={props.onOpenWorkEditor}>Ustaw godziny</button>
            </div>
          ) : null}

          {props.dayAvailability && visitCount === 0 ? (
            <div className="agenda-empty calm">
              <strong>Spokojny dzień</strong>
              <span>Wolne okno {props.dayAvailability.startTime}–{props.dayAvailability.endTime} jest widoczne dla klientów.</span>
            </div>
          ) : null}

          {dayList.map((row, index) => {
            const style = { "--i": index } as CSSProperties;
            if (row.kind === "gap") {
              const isPast = isToday && row.to <= nowMinutes;
              if (isPast) return null;
              return (
                <button
                  className="agenda-gap"
                  key={`gap-${row.from}`}
                  style={style}
                  type="button"
                  disabled={!props.canManageSchedule}
                  onClick={props.onCreateAppointment}
                >
                  <Plus aria-hidden="true" />
                  <span>Wolne {minutesToTime(row.from)}–{minutesToTime(row.to)}</span>
                  <small>Dodaj wizytę</small>
                </button>
              );
            }

            const { appointment } = row;
            const state = getTileState(appointment, props.currentDate);
            const end = minutesToTime(timeToMinutes(appointment.startTime) + appointment.durationMinutes);
            return (
              <button
                className={`agenda-tile ${appointment.color} is-${state.key}`}
                key={appointment.id}
                style={style}
                type="button"
                onClick={() => setOpenId(appointment.id)}
                aria-label={`${appointment.clientName}, ${appointment.startTime}, ${state.label}. Otwórz opcje`}
              >
                <span className="agenda-tile-time">
                  <strong>{appointment.startTime}</strong>
                  <small>{end}</small>
                </span>
                <ProfileAvatar
                  className="agenda-tile-avatar"
                  name={appointment.clientName}
                  photoUrl={appointment.clientPhotoUrl}
                />
                <span className="agenda-tile-main">
                  <strong>{appointment.clientName}</strong>
                  <span>{appointment.serviceName}</span>
                </span>
                <span className="agenda-tile-side">
                  <b>{appointment.price}</b>
                  <em>
                    {state.key === "done" ? <Check aria-hidden="true" /> : null}
                    {state.label}
                  </em>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {props.canManageSchedule ? (
        <button className="agenda-fab" type="button" onClick={props.onCreateAppointment} aria-label="Dodaj wizytę">
          <Plus aria-hidden="true" />
        </button>
      ) : null}

      {sheetOpen && selectedAppointment && sheetState ? (
        <div className={`agenda-sheet-layer ${openId ? "" : "leaving"}`} role="presentation">
          <button className="agenda-sheet-backdrop" type="button" aria-label="Zamknij" onClick={closeSheet} />
          <section
            className={`agenda-sheet ${selectedAppointment.color}`}
            role="dialog"
            aria-modal="true"
            aria-label={`Wizyta: ${selectedAppointment.clientName}`}
          >
            <span className="agenda-sheet-grab" aria-hidden="true" />
            <button className="agenda-sheet-close" type="button" onClick={closeSheet} aria-label="Zamknij">
              <X aria-hidden="true" />
            </button>

            <div className="agenda-sheet-head">
              <ProfileAvatar
                className="agenda-sheet-avatar"
                name={selectedAppointment.clientName}
                photoUrl={selectedClient?.photoUrl || selectedAppointment.clientPhotoUrl}
              />
              <div>
                <h3>{selectedAppointment.clientName}</h3>
                <small>
                  {hasPhone
                    ? `${phoneDigits.slice(0, 3)} ${phoneDigits.slice(3, 6)} ${phoneDigits.slice(6, 9)}`
                    : "Brak numeru telefonu"}
                  {selectedClient ? ` · ${selectedClient.appointments.length} wizyt` : ""}
                </small>
              </div>
              <em className={`agenda-sheet-state is-${sheetState.key}`}>{sheetState.label}</em>
            </div>

            <div className="agenda-sheet-info">
              <span>
                <small>{longDayFormatter.format(dateFromKey(selectedAppointment.dateKey))}</small>
                <strong>
                  {selectedAppointment.startTime}–
                  {minutesToTime(timeToMinutes(selectedAppointment.startTime) + selectedAppointment.durationMinutes)}
                </strong>
              </span>
              <span>
                <small>{selectedAppointment.serviceName}</small>
                <strong>{selectedAppointment.price}</strong>
              </span>
            </div>

            {props.canManageSchedule && awaitsBarber && selectedAppointment ? (
              <div className="agenda-sheet-answer">
                <p>
                  {selectedAppointment.previousDateKey
                    ? `Klient chce przenieść wizytę z ${dateFromKey(selectedAppointment.previousDateKey).toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}, ${selectedAppointment.previousStartTime}.`
                    : "Klient przeniósł tę wizytę na nowy termin."}
                </p>
                <div>
                  <button
                    className="agenda-sheet-primary"
                    type="button"
                    disabled={props.isActionPending(`confirm_admin:${selectedAppointment.id}`)}
                    aria-busy={props.isActionPending(`confirm_admin:${selectedAppointment.id}`)}
                    onClick={() => runAndClose(() => props.onConfirmAppointment(selectedAppointment))}
                  >
                    <Check aria-hidden="true" />
                    Potwierdź nowy termin
                  </button>
                  {canRefuse ? (
                    <button
                      className="agenda-sheet-refuse"
                      type="button"
                      disabled={props.isActionPending(`refuse_admin:${selectedAppointment.id}`)}
                      aria-busy={props.isActionPending(`refuse_admin:${selectedAppointment.id}`)}
                      onClick={() => runAndClose(() => props.onRefuseAppointment(selectedAppointment))}
                    >
                      <X aria-hidden="true" />
                      Odmawiam
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {props.canManageSchedule && canSettle ? (
              <button
                className="agenda-sheet-primary"
                type="button"
                disabled={Boolean(props.settlingAppointmentId)}
                aria-busy={props.isActionPending(`settle_admin:${selectedAppointment.id}`)}
                onClick={() => runAndClose(() => props.onSettleAppointment(selectedAppointment))}
              >
                <Check aria-hidden="true" />
                {props.settlingAppointmentId === selectedAppointment.id ? "Zapisywanie..." : "Rozlicz wizytę"}
              </button>
            ) : null}

            <div className="agenda-sheet-actions">
              {hasPhone ? (
                <a href={`tel:+48${phoneDigits}`}>
                  <Phone aria-hidden="true" />
                  Zadzwoń
                </a>
              ) : (
                <span className="disabled"><Phone aria-hidden="true" />Zadzwoń</span>
              )}
              {props.canManageClients && selectedClient && hasPhone ? (
                <button type="button" onClick={() => runAndClose(() => props.onOpenSms(selectedClient, selectedAppointment))}>
                  <MessageSquare aria-hidden="true" />
                  SMS
                </button>
              ) : (
                <span className="disabled"><MessageSquare aria-hidden="true" />SMS</span>
              )}
              {props.canManageClients && selectedClient ? (
                <button type="button" onClick={() => runAndClose(() => props.onOpenClient(selectedClient.id))}>
                  <User aria-hidden="true" />
                  Karta klienta
                </button>
              ) : null}
              {/* The same window changes the date, the time and the price. A settled visit can still have its price corrected. */}
              {props.canManageSchedule && (canEdit || isCompleted) ? (
                <button type="button" onClick={() => runAndClose(() => props.onEditAppointment(selectedAppointment))}>
                  <Pencil aria-hidden="true" />
                  {isCompleted ? "Popraw cenę" : "Edytuj"}
                </button>
              ) : null}
              {props.canManageSchedule && canEdit ? (
                <button
                  className="danger"
                  type="button"
                  onClick={() => runAndClose(() => props.onCancelAppointment(selectedAppointment.id))}
                >
                  <X aria-hidden="true" />
                  Odwołaj
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
