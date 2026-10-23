"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";

import ProfileAvatar from "../profile-avatar";

type BarberDetails = {
  specialties?: string;
  displayName: string;
  phone: string;
  email: string;
  instagram: string;
  bio: string;
  photoUrl: string;
};

type AvailabilityWindow = {
  id: string;
  barberId: string;
  dateKey: string;
  startTime: string;
  endTime: string;
};

type Service = {
  id: string;
  barberId: string;
  name: string;
  price: string;
  durationMinutes: number;
  order?: number;
};

type AvailabilityDraft = {
  dates: string[];
  startTime: string;
  endTime: string;
};

type ServiceDraft = {
  name: string;
  price: string;
  durationMinutes: string;
};

type BarberAdminSection = "schedule" | "clients" | "analytics" | "work" | "services" | "profile";

type BarberProfile = {
  id: string;
  name: string;
  label: string;
  accent: "blue" | "mint";
  userId: string;
  email: string;
  active: boolean;
  access: Record<BarberAdminSection, boolean>;
  createdAt?: number;
  updatedAt?: number;
};

type WorkScreenProps = {
  mode: "work";
  workspaceTabs: ReactNode;
  workspaceTab: "days" | "services";
  canManageDays: boolean;
  canManageServices: boolean;
  availabilityWindows: AvailabilityWindow[];
  nearestAvailability: AvailabilityWindow | null;
  editingAvailabilityKey: string | null;
  availabilityDraft: AvailabilityDraft;
  availabilityDraftDays: number;
  availabilityDraftDuration: number;
  availabilityOverwriteCount: number;
  canSaveAvailability: boolean;
  isWorkSaving: boolean;
  feedback: { kind: "success" | "error"; message: string } | null;
  today: Date;
  timeOptions: string[];
  availability: Record<string, AvailabilityWindow>;
  availabilityMonthGroups: Array<{
    key: string;
    label: string;
    items: AvailabilityWindow[];
    totalMinutes: number;
  }>;
  expandedAvailabilityMonth: string | null;
  pendingAvailabilityRemovalKey: string | null | undefined;
  services: Service[];
  editingService: Service | null;
  serviceDraft: ServiceDraft;
  canSaveService: boolean;
  isSavingService: boolean;
  isActionPending: (key: string) => boolean;
  onResetAvailability: () => void;
  onSetAvailabilityPreset: (startTime: string, endTime: string) => void;
  onChangeAvailabilityDates: (dates: string[]) => void;
  onUpdateAvailability: (field: "startTime" | "endTime", value: string) => void;
  onSaveAvailability: () => void;
  onToggleAvailabilityMonth: (key: string | null) => void;
  onEditAvailability: (windowItem: AvailabilityWindow) => void;
  onRemoveAvailability: (dateKey: string) => void;
  onRemoveAvailabilityMonth: (monthKey: string) => void;
  onResetService: () => void;
  onUpdateService: (field: keyof ServiceDraft, value: string) => void;
  onSaveService: () => Promise<boolean | void> | void;
  onEditService: (service: Service) => void;
  onDeleteService: (serviceId: string) => void;
};

type TeamScreenProps = {
  mode: "team";
  members: BarberProfile[];
  activeMembersCount: number;
  profiles: Record<string, BarberDetails>;
  feedback: { kind: "success" | "error"; message: string } | null;
  editedMemberId: string | null;
  isSaving: boolean;
  adminSections: BarberAdminSection[];
  accessLabels: Record<BarberAdminSection, string>;
  onActiveChange: (member: BarberProfile, active: boolean) => void;
  onEditMember: (member: BarberProfile) => void;
  onOpenBarberPanel: (barberId: string, section: "schedule" | "analytics") => void;
  onAccessChange: (member: BarberProfile, section: BarberAdminSection, enabled: boolean) => void;
};

type ProfileScreenProps = {
  mode: "profile";
  barberName: string;
  barber: { accent: "blue" | "mint"; label: string; name: string };
  draft: BarberDetails;
  feedback: { kind: "success" | "error"; message: string } | null;
  isSaving: boolean;
  isPhotoProcessing: boolean;
  isSaveActionPending: boolean;
  onPhotoChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onChange: (field: keyof BarberDetails, value: string) => void;
  onSave: () => void;
};

type AdminSettingsScreenProps = ProfileScreenProps | WorkScreenProps | TeamScreenProps;

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

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const dateFromKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const clientDateFormatter = new Intl.DateTimeFormat("pl-PL", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
});

const emptyBarberDetails: BarberDetails = {
  displayName: "",
  phone: "",
  email: "",
  instagram: "",
  bio: "",
  photoUrl: "",
};

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return [hours > 0 ? `${hours}g` : "", remainingMinutes > 0 ? `${remainingMinutes}min` : ""]
    .filter(Boolean)
    .join(" ");
};

const formatServicePrice = (value: string) => {
  const normalizedValue = value.trim().replace(",", ".");
  const numericValue = Number(normalizedValue.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numericValue)) return value.trim();
  return `${numericValue % 1 === 0 ? numericValue.toFixed(0) : numericValue.toFixed(2)} zł`;
};

const WEEKDAY_SHORT = ["Pn", "Wt", "Śr", "Cz", "Pt", "Sb", "Nd"];
const WEEKDAY_PLURAL = ["poniedziałki", "wtorki", "środy", "czwartki", "piątki", "soboty", "niedziele"];

const AVAILABILITY_PRESETS = [
  { label: "Cały dzień", startTime: "09:00", endTime: "17:00" },
  { label: "Rano", startTime: "08:00", endTime: "14:00" },
  { label: "Po południu", startTime: "14:00", endTime: "20:00" },
];

const SERVICE_TEMPLATES = [
  { name: "Strzyżenie", price: "70", durationMinutes: "45" },
  { name: "Broda", price: "40", durationMinutes: "30" },
  { name: "Włosy + broda", price: "100", durationMinutes: "60" },
  { name: "Strzyżenie dziecka", price: "50", durationMinutes: "30" },
];

const SERVICE_DURATIONS = [15, 30, 45, 60, 90, 120];
const TIME_STEP_MINUTES = 30;
const MIN_WINDOW_MINUTES = 15;

const monthLabelFormatter = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" });
const fullDateFormatter = new Intl.DateTimeFormat("pl-PL", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const mondayIndex = (date: Date) => (date.getDay() + 6) % 7;

const clockToMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

const minutesToClock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const shortDateLabel = (key: string) => {
  const date = dateFromKey(key);
  return `${WEEKDAY_SHORT[mondayIndex(date)].toLowerCase()} ${date.getDate()}.${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const durationChipLabel = (minutes: number) => {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : String(hours).replace(".", ",")} godz.`;
};

const dayCountLabel = (count: number) => `${count} ${count === 1 ? "dzień" : "dni"}`;

function WorkSettingsScreen(props: WorkScreenProps) {
  const todayKey = dayKey(props.today);
  const draft = props.availabilityDraft;
  const [viewMonth, setViewMonth] = useState(
    () => new Date(props.today.getFullYear(), props.today.getMonth(), 1),
  );
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [serviceFormOpen, setServiceFormOpen] = useState(false);
  const serviceFormRef = useRef<HTMLElement | null>(null);

  const selected = useMemo(() => new Set(draft.dates), [draft.dates]);
  const sortedDates = useMemo(() => [...draft.dates].sort(), [draft.dates]);
  const firstSelectedKey = sortedDates.length === 1 ? sortedDates[0] : null;

  useEffect(() => {
    if (!firstSelectedKey) return;
    const date = dateFromKey(firstSelectedKey);
    setViewMonth((current) =>
      current.getFullYear() === date.getFullYear() && current.getMonth() === date.getMonth()
        ? current
        : new Date(date.getFullYear(), date.getMonth(), 1),
    );
  }, [firstSelectedKey]);

  const monthDays = useMemo(() => {
    const total = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
    return Array.from(
      { length: total },
      (_, index) => new Date(viewMonth.getFullYear(), viewMonth.getMonth(), index + 1),
    );
  }, [viewMonth]);
  const upcomingMonthDays = monthDays.filter((date) => dayKey(date) >= todayKey);
  const monthPrefix = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, "0")}`;
  const savedInMonth = Object.keys(props.availability).filter(
    (key) => key.startsWith(monthPrefix) && key >= todayKey,
  ).length;
  const isCurrentMonth =
    viewMonth.getFullYear() === props.today.getFullYear() &&
    viewMonth.getMonth() === props.today.getMonth();

  const tomorrow = new Date(props.today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = dayKey(tomorrow);

  const changeDates = (dates: string[]) =>
    props.onChangeAvailabilityDates(Array.from(new Set(dates)).sort());
  const toggleKeys = (keys: string[]) => {
    if (keys.length === 0) return;
    const allSelected = keys.every((key) => selected.has(key));
    changeDates(allSelected ? draft.dates.filter((key) => !keys.includes(key)) : [...draft.dates, ...keys]);
  };
  const keysAllSelected = (keys: string[]) => keys.length > 0 && keys.every((key) => selected.has(key));

  const monthKeys = upcomingMonthDays.map(dayKey);
  const workdayKeys = upcomingMonthDays.filter((date) => mondayIndex(date) < 5).map(dayKey);
  const weekdayKeys = (index: number) =>
    upcomingMonthDays.filter((date) => mondayIndex(date) === index).map(dayKey);

  const startMinutes = clockToMinutes(draft.startTime);
  const endMinutes = clockToMinutes(draft.endTime);
  const firstTime = clockToMinutes(props.timeOptions[0] ?? "06:00");
  const lastTime = clockToMinutes(props.timeOptions[props.timeOptions.length - 1] ?? "22:00");
  const setStart = (minutes: number) => props.onUpdateAvailability("startTime", minutesToClock(minutes));
  const setEnd = (minutes: number) => props.onUpdateAvailability("endTime", minutesToClock(minutes));

  const dayCount = draft.dates.length;
  const isEditingDay = Boolean(props.editingAvailabilityKey);
  const shownDates = sortedDates.slice(0, 4).map(shortDateLabel).join(", ");
  const extraDates = dayCount > 4 ? ` i ${dayCount - 4} więcej` : "";

  const firstDayOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const leadingBlanks = mondayIndex(firstDayOfMonth);

  const draftService = props.serviceDraft;
  const serviceFormVisible = serviceFormOpen || Boolean(props.editingService);
  const servicePrice = Number(draftService.price.replace(",", ".").replace(/[^\d.]/g, ""));
  const serviceDuration = Number(draftService.durationMinutes) || 0;
  const serviceHint =
    draftService.name.trim().length < 2
      ? "Wpisz nazwę usługi."
      : !(servicePrice > 0)
        ? "Wpisz cenę, na przykład 70."
        : serviceDuration < 15
          ? "Wybierz, ile trwa usługa."
          : null;
  const durationChoices = Array.from(
    new Set(serviceDuration > 0 ? [...SERVICE_DURATIONS, serviceDuration] : SERVICE_DURATIONS),
  ).sort((first, second) => first - second);

  useEffect(() => {
    if (!serviceFormVisible) return;
    serviceFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [serviceFormVisible, props.editingService?.id]);

  const openNewServiceForm = () => {
    props.onResetService();
    setServiceFormOpen(true);
  };
  const closeServiceForm = () => {
    props.onResetService();
    setServiceFormOpen(false);
  };
  const saveServiceAndClose = async () => {
    const saved = await props.onSaveService();
    if (saved) setServiceFormOpen(false);
  };
  const applyServiceTemplate = (template: (typeof SERVICE_TEMPLATES)[number]) => {
    props.onUpdateService("name", template.name);
    props.onUpdateService("price", template.price);
    props.onUpdateService("durationMinutes", template.durationMinutes);
  };

  return (
    <div className="admin-tab-panel work-workspace-panel active">
      {props.workspaceTabs}
      {props.canManageDays && props.workspaceTab === "days" ? (
        <>
          <div className="admin-section-header">
            <div>
              <p className="eyebrow">Dostępność</p>
              <h2>Dni pracy</h2>
            </div>
            <div className="admin-section-stats" aria-label="Podsumowanie dostępności">
              <span>
                <strong>{props.availabilityWindows.length}</strong>
                dni
              </span>
              <span>
                <strong>{props.nearestAvailability ? shortDateLabel(props.nearestAvailability.dateKey) : "—"}</strong>
                najbliżej
              </span>
            </div>
          </div>

          <div className="work-view casual" aria-label="Moja dostępność">
            <section className="work-editor-card availability-maker" id="availability-maker">
              <div className="work-editor-top">
                <div>
                  <p className="eyebrow">{isEditingDay ? "Zmieniasz istniejący dzień" : "Nowe dni pracy"}</p>
                  <h2>{isEditingDay ? "Zmień dzień pracy" : "Kiedy pracujesz?"}</h2>
                </div>
                {isEditingDay ? (
                  <button className="work-editor-cancel" type="button" onClick={props.onResetAvailability}>
                    Anuluj zmianę
                  </button>
                ) : null}
              </div>

              <div className="wk-block">
                <h3 className="wk-step-title"><b>1</b>Wybierz dni</h3>
                <p className="wk-help">
                  Dotknij przycisku, żeby zaznaczyć. Dotknij jeszcze raz, żeby odznaczyć.
                </p>

                <div className="wk-month-nav">
                  <button
                    type="button"
                    aria-label="Poprzedni miesiąc"
                    disabled={isCurrentMonth}
                    onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
                  >
                    ‹
                  </button>
                  <strong>{monthLabelFormatter.format(viewMonth)}</strong>
                  <button
                    type="button"
                    aria-label="Następny miesiąc"
                    onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
                  >
                    ›
                  </button>
                </div>

                <div className="wk-chips" role="group" aria-label="Szybki wybór dni w tym miesiącu">
                  <button
                    type="button"
                    className={keysAllSelected(monthKeys) ? "active" : ""}
                    aria-pressed={keysAllSelected(monthKeys)}
                    disabled={monthKeys.length === 0}
                    onClick={() => toggleKeys(monthKeys)}
                  >
                    Cały miesiąc
                  </button>
                  <button
                    type="button"
                    className={keysAllSelected(workdayKeys) ? "active" : ""}
                    aria-pressed={keysAllSelected(workdayKeys)}
                    disabled={workdayKeys.length === 0}
                    onClick={() => toggleKeys(workdayKeys)}
                  >
                    Poniedziałek–piątek
                  </button>
                </div>

                <p className="wk-label">Tylko wybrane dni tygodnia</p>
                <div className="wk-weekdays" role="group" aria-label="Dni tygodnia w tym miesiącu">
                  {WEEKDAY_SHORT.map((label, index) => {
                    const keys = weekdayKeys(index);
                    const active = keysAllSelected(keys);
                    return (
                      <button
                        key={label}
                        type="button"
                        className={active ? "active" : ""}
                        aria-pressed={active}
                        aria-label={`Wszystkie ${WEEKDAY_PLURAL[index]} w tym miesiącu`}
                        disabled={keys.length === 0}
                        onClick={() => toggleKeys(keys)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <p className="wk-label">Pojedyncze dni</p>
                <div className="wk-chips" role="group" aria-label="Pojedyncze dni">
                  <button
                    type="button"
                    className={selected.has(todayKey) ? "active" : ""}
                    aria-pressed={selected.has(todayKey)}
                    onClick={() => toggleKeys([todayKey])}
                  >
                    Dziś
                  </button>
                  <button
                    type="button"
                    className={selected.has(tomorrowKey) ? "active" : ""}
                    aria-pressed={selected.has(tomorrowKey)}
                    onClick={() => toggleKeys([tomorrowKey])}
                  >
                    Jutro
                  </button>
                  <button
                    type="button"
                    className="wk-clear"
                    disabled={dayCount === 0}
                    onClick={() => changeDates([])}
                  >
                    Wyczyść wybór
                  </button>
                </div>

                <button
                  className="wk-calendar-toggle"
                  type="button"
                  aria-expanded={calendarOpen}
                  aria-controls="wk-calendar"
                  onClick={() => setCalendarOpen((open) => !open)}
                >
                  <span>
                    <strong>{calendarOpen ? "Ukryj kalendarz" : "Pokaż kalendarz"}</strong>
                    <small>
                      {savedInMonth > 0
                        ? `W tym miesiącu masz już ${dayCountLabel(savedInMonth)} dostępnych`
                        : "W tym miesiącu nie masz jeszcze dostępnych dni"}
                    </small>
                  </span>
                  <b aria-hidden="true">⌄</b>
                </button>

                {calendarOpen ? (
                  <div className="wk-calendar" id="wk-calendar">
                    <div className="wk-calendar-head" aria-hidden="true">
                      {WEEKDAY_SHORT.map((label) => <span key={label}>{label}</span>)}
                    </div>
                    <div className="wk-calendar-grid">
                      {Array.from({ length: leadingBlanks }, (_, index) => (
                        <span key={`blank-${index}`} aria-hidden="true" />
                      ))}
                      {monthDays.map((date) => {
                        const key = dayKey(date);
                        const isPast = key < todayKey;
                        const isSelected = selected.has(key);
                        const isSaved = Boolean(props.availability[key]) && !isPast;
                        return (
                          <button
                            key={key}
                            type="button"
                            className={`wk-day${isSelected ? " selected" : ""}${isSaved ? " saved" : ""}`}
                            disabled={isPast}
                            aria-pressed={isSelected}
                            aria-label={`${fullDateFormatter.format(date)}${isSaved ? ", już dostępny" : ""}`}
                            onClick={() => toggleKeys([key])}
                          >
                            {date.getDate()}
                          </button>
                        );
                      })}
                    </div>
                    <div className="wk-legend">
                      <span><i className="selected" aria-hidden="true" />Wybrane teraz</span>
                      <span><i className="saved" aria-hidden="true" />Już dostępne dla klientów</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="wk-block">
                <h3 className="wk-step-title"><b>2</b>Wybierz godziny</h3>
                <div className="work-preset-grid">
                  {AVAILABILITY_PRESETS.map((preset) => {
                    const active = draft.startTime === preset.startTime && draft.endTime === preset.endTime;
                    return (
                      <button
                        className={active ? "active" : ""}
                        key={preset.label}
                        type="button"
                        onClick={() => props.onSetAvailabilityPreset(preset.startTime, preset.endTime)}
                        aria-pressed={active}
                      >
                        <strong>{preset.label}</strong>
                        <span>{preset.startTime}–{preset.endTime}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="wk-time-stepper">
                  <span>Od</span>
                  <button
                    type="button"
                    aria-label="Zacznij 30 minut wcześniej"
                    disabled={startMinutes - TIME_STEP_MINUTES < firstTime}
                    onClick={() => setStart(startMinutes - TIME_STEP_MINUTES)}
                  >
                    −
                  </button>
                  <strong>{draft.startTime}</strong>
                  <button
                    type="button"
                    aria-label="Zacznij 30 minut później"
                    disabled={startMinutes + TIME_STEP_MINUTES > endMinutes - MIN_WINDOW_MINUTES}
                    onClick={() => setStart(startMinutes + TIME_STEP_MINUTES)}
                  >
                    +
                  </button>
                </div>
                <div className="wk-time-stepper">
                  <span>Do</span>
                  <button
                    type="button"
                    aria-label="Skończ 30 minut wcześniej"
                    disabled={endMinutes - TIME_STEP_MINUTES < startMinutes + MIN_WINDOW_MINUTES}
                    onClick={() => setEnd(endMinutes - TIME_STEP_MINUTES)}
                  >
                    −
                  </button>
                  <strong>{draft.endTime}</strong>
                  <button
                    type="button"
                    aria-label="Skończ 30 minut później"
                    disabled={endMinutes + TIME_STEP_MINUTES > lastTime}
                    onClick={() => setEnd(endMinutes + TIME_STEP_MINUTES)}
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="wk-block">
                <h3 className="wk-step-title"><b>3</b>Sprawdź i zapisz</h3>
                <div className="availability-summary-panel">
                  <div>
                    {dayCount === 0 ? (
                      <>
                        <strong>Nie wybrano jeszcze żadnego dnia</strong>
                        <span>Wróć do kroku 1 i dotknij dni, w które pracujesz.</span>
                      </>
                    ) : (
                      <>
                        <strong>{isEditingDay ? "Zapiszesz zmianę" : "Dodasz do kalendarza"}</strong>
                        <span>
                          {dayCountLabel(dayCount)} · {draft.startTime} - {draft.endTime} ·{" "}
                          {formatDuration(Math.max(0, props.availabilityDraftDuration))} dziennie
                        </span>
                        <span>{shownDates}{extraDates}</span>
                        {props.availabilityOverwriteCount > 0 ? (
                          <small>
                            {props.availabilityOverwriteCount === 1
                              ? "1 zapisany dzień dostanie nowe godziny"
                              : `${props.availabilityOverwriteCount} zapisane dni dostaną nowe godziny`}
                          </small>
                        ) : null}
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={props.onSaveAvailability}
                    disabled={!props.canSaveAvailability || props.isWorkSaving}
                    aria-busy={props.isActionPending("save_availability")}
                  >
                    {props.isWorkSaving
                      ? "Zapisywanie..."
                      : dayCount === 0
                        ? "Najpierw wybierz dni"
                        : isEditingDay
                          ? "Zapisz zmianę"
                          : `Zapisz ${dayCountLabel(dayCount)}`}
                  </button>
                </div>
                {props.feedback ? (
                  <p className={`work-feedback ${props.feedback.kind}`} role="status">{props.feedback.message}</p>
                ) : null}
              </div>
            </section>

            <section className="availability-list-card">
              <div className="work-card-heading">
                <div>
                  <p className="eyebrow">Widoczne dla klientów</p>
                  <h2>Twoje dostępne dni</h2>
                </div>
              </div>
              <div className="availability-month-list">
                {props.availabilityMonthGroups.length > 0 ? (
                  props.availabilityMonthGroups.map((monthGroup) => {
                    const isExpanded = props.expandedAvailabilityMonth === monthGroup.key;
                    return (
                      <section className={`availability-month ${isExpanded ? "expanded" : ""}`} key={monthGroup.key}>
                        <button
                          className="availability-month-toggle"
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => props.onToggleAvailabilityMonth(isExpanded ? null : monthGroup.key)}
                        >
                          <span>
                            <strong>{monthGroup.label}</strong>
                            <small>
                              {dayCountLabel(monthGroup.items.length)} · {formatDuration(monthGroup.totalMinutes)}
                            </small>
                          </span>
                          <b aria-hidden="true">⌄</b>
                        </button>
                        <div className="availability-window-list">
                          {monthGroup.items.map((windowItem) => (
                            <article className="availability-window-row" key={windowItem.id}>
                              <div>
                                <strong>{clientDateFormatter.format(dateFromKey(windowItem.dateKey))}</strong>
                                <span>{windowItem.startTime} - {windowItem.endTime}</span>
                              </div>
                              <div className="availability-window-actions">
                                <button type="button" onClick={() => props.onEditAvailability(windowItem)}>Zmień</button>
                                <button
                                  className={
                                    props.pendingAvailabilityRemovalKey === windowItem.dateKey
                                      ? "confirm-remove"
                                      : "remove"
                                  }
                                  type="button"
                                  disabled={props.isWorkSaving}
                                  aria-busy={props.isActionPending("remove_availability")}
                                  onClick={() => props.onRemoveAvailability(windowItem.dateKey)}
                                >
                                  {props.pendingAvailabilityRemovalKey === windowItem.dateKey ? "Na pewno?" : "Usuń"}
                                </button>
                              </div>
                            </article>
                          ))}
                          <button
                            className="wk-remove-month"
                            type="button"
                            disabled={props.isWorkSaving}
                            onClick={() => props.onRemoveAvailabilityMonth(monthGroup.key)}
                          >
                            Usuń wszystkie dni z tego miesiąca
                          </button>
                        </div>
                      </section>
                    );
                  })
                ) : (
                  <p>Nie masz jeszcze żadnego dostępnego dnia. Wybierz dni powyżej i zapisz.</p>
                )}
              </div>
            </section>
          </div>
        </>
      ) : null}

      {props.canManageServices && props.workspaceTab === "services" ? (
        <>
          <div className="admin-section-header">
            <div>
              <p className="eyebrow">Oferta</p>
              <h2>Usługi</h2>
            </div>
            <div className="admin-section-stats" aria-label="Podsumowanie usług">
              <span><strong>{props.services.length}</strong>usług</span>
              <span>
                <strong>
                  {formatDuration(
                    Math.round(
                      props.services.reduce((sum, service) => sum + service.durationMinutes, 0) /
                        Math.max(props.services.length, 1),
                    ),
                  )}
                </strong>
                średnio
              </span>
            </div>
          </div>

          <div className="services-admin-view" aria-label="Zarządzanie usługami">
            {serviceFormVisible ? (
              <section className="service-editor-panel wk-step" ref={serviceFormRef}>
                <div className="work-editor-top">
                  <div>
                    <p className="eyebrow">{props.editingService ? "Zmieniasz usługę" : "Nowa usługa"}</p>
                    <h2>{props.editingService ? props.editingService.name : "Dodaj usługę"}</h2>
                  </div>
                  <button className="service-cancel-button" type="button" onClick={closeServiceForm}>
                    Anuluj
                  </button>
                </div>

                <div className="wk-block">
                  <h3 className="wk-step-title"><b>1</b>Jaka to usługa?</h3>
                  {!props.editingService ? (
                    <>
                      <p className="wk-help">Dotknij gotowca albo wpisz własną nazwę.</p>
                      <div className="wk-chips" role="group" aria-label="Gotowe usługi">
                        {SERVICE_TEMPLATES.map((template) => (
                          <button
                            key={template.name}
                            type="button"
                            className={draftService.name === template.name ? "active" : ""}
                            onClick={() => applyServiceTemplate(template)}
                          >
                            {template.name}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                  <div className="service-form-grid">
                    <label>
                      Nazwa usługi
                      <input
                        type="text"
                        maxLength={60}
                        placeholder="Na przykład: Strzyżenie klasyczne"
                        value={draftService.name}
                        onChange={(event) => props.onUpdateService("name", event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div className="wk-block">
                  <h3 className="wk-step-title"><b>2</b>Ile kosztuje i ile trwa?</h3>
                  <div className="service-form-grid">
                    <label>
                      Cena
                      <span className="wk-price-field">
                        <input
                          inputMode="decimal"
                          type="text"
                          maxLength={7}
                          placeholder="70"
                          value={draftService.price}
                          onChange={(event) =>
                            props.onUpdateService("price", event.target.value.replace(/[^\d.,]/g, ""))
                          }
                        />
                        <b aria-hidden="true">zł</b>
                      </span>
                    </label>
                  </div>
                  <p className="wk-label">Czas trwania</p>
                  <div className="wk-chips" role="group" aria-label="Czas trwania usługi">
                    {durationChoices.map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        className={serviceDuration === minutes ? "active" : ""}
                        aria-pressed={serviceDuration === minutes}
                        onClick={() => props.onUpdateService("durationMinutes", String(minutes))}
                      >
                        {durationChipLabel(minutes)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="wk-block">
                  <h3 className="wk-step-title"><b>3</b>Sprawdź i zapisz</h3>
                  <div className="service-editor-summary">
                    <span>
                      Klient zobaczy: {draftService.name.trim() || "Nazwa usługi"} ·{" "}
                      {servicePrice > 0 ? formatServicePrice(draftService.price) : "cena"} ·{" "}
                      {serviceDuration >= 15 ? durationChipLabel(serviceDuration) : "czas"}
                    </span>
                    {serviceHint ? <small className="wk-hint">{serviceHint}</small> : null}
                    <button
                      type="button"
                      disabled={!props.canSaveService || props.isSavingService}
                      aria-busy={props.isActionPending("save_service")}
                      onClick={() => void saveServiceAndClose()}
                    >
                      {props.isSavingService
                        ? "Zapisywanie..."
                        : props.editingService
                          ? "Zapisz zmiany"
                          : "Zapisz usługę"}
                    </button>
                  </div>
                  {props.feedback ? (
                    <p className={`work-feedback ${props.feedback.kind}`} role="status">{props.feedback.message}</p>
                  ) : null}
                </div>
              </section>
            ) : (
              <>
                <button className="wk-add-button" type="button" onClick={openNewServiceForm}>
                  + Dodaj usługę
                </button>
                {props.feedback ? (
                  <p className={`work-feedback ${props.feedback.kind}`} role="status">{props.feedback.message}</p>
                ) : null}
              </>
            )}

            <section className="service-management-list" aria-label="Lista usług">
              {props.services.map((service) => (
                <article
                  className={`service-management-card${props.editingService?.id === service.id ? " editing" : ""}`}
                  key={service.id}
                >
                  <div>
                    <strong>{service.name}</strong>
                    <span>{service.price} · {formatDuration(service.durationMinutes)}</span>
                  </div>
                  <div className="service-management-actions">
                    <button type="button" onClick={() => props.onEditService(service)}>Zmień</button>
                    <button
                      className="danger"
                      type="button"
                      disabled={props.services.length <= 1 || props.isSavingService}
                      aria-busy={props.isActionPending(`delete_service:${service.id}`)}
                      onClick={() => props.onDeleteService(service.id)}
                    >
                      Usuń
                    </button>
                  </div>
                </article>
              ))}
              {props.services.length <= 1 ? (
                <p className="wk-help">Musi zostać przynajmniej jedna usługa, więc tej nie da się usunąć.</p>
              ) : null}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}

function TeamSettingsScreen(props: TeamScreenProps) {
  return (
    <div className="admin-tab-panel active">
      <div className="admin-section-header team-section-header">
        <div>
          <p className="eyebrow">Ustawienia właściciela</p>
          <h2>Zespół BNB</h2>
        </div>
        <div className="admin-section-stats" aria-label="Stan zespołu">
          <span><strong>{props.members.length}</strong>barberzy</span>
          <span><strong>{props.activeMembersCount}</strong>aktywne konta</span>
        </div>
      </div>

      <div className="team-management-view">
        <div className="team-management-toolbar">
          <div>
            <p className="section-label">Stały skład</p>
            <strong>Konta i zakres dostępu</strong>
          </div>
        </div>

        {props.feedback && !props.editedMemberId ? (
          <p className={`work-feedback ${props.feedback.kind}`}>{props.feedback.message}</p>
        ) : null}

        <div className="team-member-list">
          {props.members.map((member) => {
            const profile = props.profiles[member.id] ?? emptyBarberDetails;
            return (
              <article className={`team-member-card ${member.active ? "active" : "inactive"}`} key={member.id}>
                <header className="team-member-header">
                  <ProfileAvatar
                    className={`team-member-avatar ${member.accent}`}
                    name={profile.displayName || member.name}
                    photoUrl={profile.photoUrl}
                  />
                  <div>
                    <small>{member.label}</small>
                    <strong>{profile.displayName || member.name}</strong>
                    <span>{member.email || profile.email || "Brak adresu e-mail"}</span>
                  </div>
                  <label className="team-active-switch">
                    <input
                      type="checkbox"
                      checked={member.active}
                      disabled={props.isSaving}
                      onChange={(event) => props.onActiveChange(member, event.target.checked)}
                    />
                    <span aria-hidden="true" />
                    {member.active ? "Aktywne" : "Wyłączone"}
                  </label>
                </header>

                <div className="team-member-account">
                  <span>
                    <small>Konto Google</small>
                    <strong>Połączone</strong>
                  </span>
                  <div className="team-member-account-actions">
                    <button type="button" onClick={() => props.onEditMember(member)}>Edytuj dane</button>
                  </div>
                </div>

                <div className="team-member-quick-actions">
                  <button type="button" onClick={() => props.onOpenBarberPanel(member.id, "schedule")}>
                    <span className="schedule-icon" aria-hidden="true" />
                    Terminarz
                  </button>
                  <button type="button" onClick={() => props.onOpenBarberPanel(member.id, "analytics")}>
                    <span className="analytics-icon" aria-hidden="true" />
                    Analiza
                  </button>
                </div>

                <fieldset className="team-access-grid">
                  <legend>Zakres dostępu</legend>
                  {props.adminSections.map((section) => (
                    <label key={section}>
                      <input
                        type="checkbox"
                        checked={member.access[section]}
                        disabled={props.isSaving}
                        onChange={(event) => props.onAccessChange(member, section, event.target.checked)}
                      />
                      <span aria-hidden="true" />
                      {props.accessLabels[section]}
                    </label>
                  ))}
                </fieldset>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BarberProfileScreen(props: ProfileScreenProps) {
  return (
    <div className="admin-tab-panel active">
      <div className="admin-section-header">
        <div>
          <p className="eyebrow">Wizytówka barbera</p>
          <h2>Profil {props.barberName}</h2>
        </div>
        <div className="admin-section-stats" aria-label="Stan profilu">
          <span>
            <strong>{props.draft.photoUrl ? "jest" : "brak"}</strong>
            zdjęcie
          </span>
          <span>
            <strong>{props.draft.bio ? "gotowy" : "pusty"}</strong>
            opis
          </span>
        </div>
      </div>

      <div className="barber-profile-view">
        <section className="barber-profile-preview">
          <ProfileAvatar
            className={`barber-profile-photo ${props.barber.accent}`}
            name={props.barberName}
            photoUrl={props.draft.photoUrl}
            alt={`Profil ${props.barberName}`}
          />
          <div className="barber-profile-preview-copy">
            <p className="eyebrow">{props.barber.label}</p>
            <h3>{props.draft.displayName || props.barber.name}</h3>
            {props.draft.instagram ? <span>@{props.draft.instagram}</span> : null}
          </div>
          <div className="barber-photo-actions">
            <label className="profile-photo-button">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={props.onPhotoChange}
              />
              {props.isPhotoProcessing ? "Przetwarzanie..." : "Wybierz zdjęcie"}
            </label>
            {props.draft.photoUrl ? (
              <button type="button" onClick={() => props.onChange("photoUrl", "")}>
                Usuń
              </button>
            ) : null}
          </div>
        </section>

        <form
          className="barber-profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSave();
          }}
        >
          <div className="barber-profile-form-heading">
            <div>
              <p className="eyebrow">Informacje</p>
              <h3>Dane profilu</h3>
            </div>
            <span>Opcjonalne</span>
          </div>

          <div className="barber-profile-fields">
            <label>
              Imię i nazwisko (wyświetlane publicznie)
              <input
                type="text"
                maxLength={50}
                value={props.draft.displayName}
                onChange={(event) => props.onChange("displayName", event.target.value)}
                placeholder={props.barber.name}
              />
            </label>
            <label>
              Numer telefonu
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={props.draft.phone}
                onChange={(event) => props.onChange("phone", formatPhoneNumber(event.target.value))}
                placeholder="500 000 000"
              />
            </label>
            <label>
              E-mail
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={100}
                value={props.draft.email}
                onChange={(event) => props.onChange("email", event.target.value)}
                placeholder="barber@example.com"
              />
            </label>
            <label>
              Instagram
              <span className="profile-instagram-input">
                <b aria-hidden="true">@</b>
                <input
                  type="text"
                  inputMode="text"
                  maxLength={120}
                  value={props.draft.instagram}
                  onChange={(event) => props.onChange("instagram", event.target.value.replace(/^@+/, ""))}
                  placeholder="nazwa_profilu lub https://instagram.com/..."
                />
              </span>
            </label>
            <label className="barber-profile-bio">
              Specjalizacje
              <input maxLength={180} value={props.draft.specialties ?? ""}
                onChange={(event) => props.onChange("specialties", event.target.value)}
                placeholder="np. fade, broda, klasyczne strzyżenie" />
            </label>
            <label className="barber-profile-bio">
              Krótki opis
              <textarea
                maxLength={280}
                value={props.draft.bio}
                onChange={(event) => props.onChange("bio", event.target.value)}
                placeholder="Kilka słów o specjalizacji i stylu pracy"
              />
              <small>{props.draft.bio.length}/280</small>
            </label>
          </div>

          <div className="barber-profile-submit">
            {props.feedback ? (
              <p className={`work-feedback ${props.feedback.kind}`}>{props.feedback.message}</p>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={props.isSaving || props.isPhotoProcessing}
              aria-busy={props.isSaveActionPending || props.isPhotoProcessing}
            >
              {props.isSaving ? "Zapisywanie..." : "Zapisz profil"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AdminSettingsScreen(props: AdminSettingsScreenProps) {
  if (props.mode === "profile") return <BarberProfileScreen {...props} />;
  if (props.mode === "work") return <WorkSettingsScreen {...props} />;
  return <TeamSettingsScreen {...props} />;
}
