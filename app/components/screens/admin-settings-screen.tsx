"use client";

import type { ChangeEvent, ReactNode } from "react";

import ProfileAvatar from "../profile-avatar";

type BarberDetails = {
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
  start: string;
  end: string;
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
  quickAvailabilityOptions: Array<{
    label: string;
    offset: number;
    startTime: string;
    endTime: string;
    date: Date;
    dateKey: string;
  }>;
  availability: Record<string, AvailabilityWindow>;
  availabilityMonthGroups: Array<{
    key: string;
    label: string;
    items: AvailabilityWindow[];
    totalMinutes: number;
  }>;
  expandedAvailabilityMonth: string | null | undefined;
  pendingAvailabilityRemovalKey: string | null | undefined;
  services: Service[];
  editingService: Service | null;
  serviceDraft: ServiceDraft;
  canSaveService: boolean;
  isSavingService: boolean;
  isActionPending: (key: string) => boolean;
  onResetAvailability: () => void;
  onSetAvailabilityPreset: (startTime: string, endTime: string) => void;
  onUpdateAvailability: (field: keyof AvailabilityDraft, value: string) => void;
  onSaveAvailability: () => void;
  onQuickAddAvailability: (offset: number, startTime: string, endTime: string) => void;
  onToggleAvailabilityMonth: (key: string | null) => void;
  onEditAvailability: (windowItem: AvailabilityWindow) => void;
  onRemoveAvailability: (dateKey: string) => void;
  onResetService: () => void;
  onUpdateService: (field: keyof ServiceDraft, value: string) => void;
  onSaveService: () => void;
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

function WorkSettingsScreen(props: WorkScreenProps) {
  return (
    <div className="admin-tab-panel work-workspace-panel active">
      {props.workspaceTabs}
      {props.canManageDays && props.workspaceTab === "days" ? (
        <>
          <div className="admin-section-header">
            <div>
              <p className="eyebrow">Dorywczo</p>
              <h2>Dni dostępne dla klientów</h2>
            </div>
            <div className="admin-section-stats" aria-label="Podsumowanie dostępności">
              <span>
                <strong>{props.availabilityWindows.length}</strong>
                dni
              </span>
              <span>
                <strong>{props.nearestAvailability?.startTime ?? "—"}</strong>
                najbliżej
              </span>
            </div>
          </div>

          <div className="work-view casual" aria-label="Moja dostępność">
            <section className="work-editor-card availability-maker" id="availability-maker">
              <div className="work-editor-top">
                <div>
                  <p className="eyebrow">
                    {props.editingAvailabilityKey ? "Edycja dostępności" : "Nowa dostępność"}
                  </p>
                  <h2>{props.editingAvailabilityKey ? "Zmień dzień pracy" : "Okienko w kalendarzu"}</h2>
                </div>
                {props.editingAvailabilityKey ? (
                  <button className="work-editor-cancel" type="button" onClick={props.onResetAvailability}>
                    Anuluj
                  </button>
                ) : null}
              </div>

              <div className="work-preset-grid">
                {[
                  { label: "Po pracy", startTime: "17:00", endTime: "20:00" },
                  { label: "Wolne rano", startTime: "10:00", endTime: "13:00" },
                  { label: "Krótko", startTime: "18:00", endTime: "19:30" },
                ].map((preset) => (
                  <button
                    className={
                      props.availabilityDraft.startTime === preset.startTime &&
                      props.availabilityDraft.endTime === preset.endTime
                        ? "active"
                        : ""
                    }
                    key={preset.label}
                    type="button"
                    onClick={() => props.onSetAvailabilityPreset(preset.startTime, preset.endTime)}
                    aria-pressed={
                      props.availabilityDraft.startTime === preset.startTime &&
                      props.availabilityDraft.endTime === preset.endTime
                    }
                  >
                    <strong>{preset.label}</strong>
                    <span>{preset.startTime} - {preset.endTime}</span>
                  </button>
                ))}
              </div>

              <div className="work-time-controls pro">
                <label>
                  Od daty
                  <input
                    type="date"
                    min={dayKey(props.today)}
                    value={props.availabilityDraft.start}
                    onChange={(event) => props.onUpdateAvailability("start", event.target.value)}
                  />
                </label>
                <label>
                  Do daty
                  <input
                    type="date"
                    min={props.availabilityDraft.start}
                    value={props.availabilityDraft.end}
                    onChange={(event) => props.onUpdateAvailability("end", event.target.value)}
                  />
                </label>
                <label>
                  Od godziny
                  <select
                    value={props.availabilityDraft.startTime}
                    onChange={(event) => props.onUpdateAvailability("startTime", event.target.value)}
                  >
                    {props.timeOptions.slice(0, -1).map((time) => <option key={time} value={time}>{time}</option>)}
                  </select>
                </label>
                <label>
                  Do godziny
                  <select
                    value={props.availabilityDraft.endTime}
                    onChange={(event) => props.onUpdateAvailability("endTime", event.target.value)}
                  >
                    {props.timeOptions.slice(1).map((time) => <option key={time} value={time}>{time}</option>)}
                  </select>
                </label>
              </div>

              <div className="availability-summary-panel">
                <div>
                  <strong>{props.editingAvailabilityKey ? "Zapiszesz zmianę" : "Dodasz dostępność"}</strong>
                  <span>
                    {props.availabilityDraftDays} {props.availabilityDraftDays === 1 ? "dzień" : "dni"} ·{" "}
                    {formatDuration(Math.max(0, props.availabilityDraftDuration))} dziennie
                  </span>
                  {props.availabilityOverwriteCount > 0 ? (
                    <small>
                      {props.availabilityOverwriteCount === 1
                        ? "1 istniejący dzień zostanie zaktualizowany"
                        : `${props.availabilityOverwriteCount} istniejące dni zostaną zaktualizowane`}
                    </small>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={props.onSaveAvailability}
                  disabled={!props.canSaveAvailability || props.isWorkSaving}
                  aria-busy={props.isActionPending("save_availability")}
                >
                  {props.isWorkSaving
                    ? "Zapisywanie..."
                    : props.editingAvailabilityKey
                      ? "Zapisz zmiany"
                      : "Dodaj dostępność"}
                </button>
              </div>
              {props.feedback ? (
                <p className={`work-feedback ${props.feedback.kind}`} role="status">{props.feedback.message}</p>
              ) : null}
            </section>

            <section className="work-editor-card">
              <div className="work-editor-top">
                <div>
                  <p className="eyebrow">Szybkie dodawanie</p>
                  <h2>Gotowe okienka</h2>
                </div>
              </div>
              <div className="quick-availability-list">
                {props.quickAvailabilityOptions.map((option) => (
                  <button
                    className={props.availability[option.dateKey] ? "existing" : ""}
                    key={`${option.dateKey}-${option.startTime}`}
                    type="button"
                    disabled={props.isWorkSaving}
                    aria-busy={props.isActionPending("quick_availability")}
                    onClick={() => props.onQuickAddAvailability(option.offset, option.startTime, option.endTime)}
                  >
                    <span className="quick-availability-date">
                      <strong>{option.label}</strong>
                      <small>{clientDateFormatter.format(option.date)}</small>
                    </span>
                    <span className="quick-availability-time">
                      <strong>{option.startTime}-{option.endTime}</strong>
                      <small>{props.availability[option.dateKey] ? "Zaktualizuj" : "Dodaj"}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="availability-list-card">
              <div className="work-card-heading">
                <div>
                  <p className="eyebrow">Widoczne dla klientów</p>
                  <h2>Aktywne dni</h2>
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
                              {monthGroup.items.length} {monthGroup.items.length === 1 ? "dzień" : "dni"} ·{" "}
                              {formatDuration(monthGroup.totalMinutes)}
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
                                <button type="button" onClick={() => props.onEditAvailability(windowItem)}>Edytuj</button>
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
                                  {props.pendingAvailabilityRemovalKey === windowItem.dateKey ? "Potwierdź" : "Usuń"}
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    );
                  })
                ) : (
                  <p>Nie masz jeszcze żadnego dostępnego dnia.</p>
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
              <h2>Usługi w aplikacji</h2>
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
            <section className="service-editor-panel">
              <div className="work-editor-top">
                <div>
                  <p className="eyebrow">{props.editingService ? "Edycja" : "Nowa usługa"}</p>
                  <h2>{props.editingService ? props.editingService.name : "Dodaj usługę"}</h2>
                </div>
                {props.editingService ? (
                  <button className="service-cancel-button" type="button" onClick={props.onResetService}>Anuluj</button>
                ) : null}
              </div>

              <div className="service-form-grid">
                <label>
                  Nazwa usługi
                  <input
                    type="text"
                    value={props.serviceDraft.name}
                    onChange={(event) => props.onUpdateService("name", event.target.value)}
                  />
                </label>
                <label>
                  Cena
                  <input
                    inputMode="decimal"
                    type="text"
                    value={props.serviceDraft.price}
                    onChange={(event) => props.onUpdateService("price", event.target.value)}
                  />
                </label>
                <label>
                  Czas trwania
                  <input
                    inputMode="numeric"
                    min="15"
                    step="15"
                    type="number"
                    value={props.serviceDraft.durationMinutes}
                    onChange={(event) => props.onUpdateService("durationMinutes", event.target.value)}
                  />
                </label>
              </div>

              <div className="service-editor-summary">
                <span>
                  {props.serviceDraft.name.trim() || "Nazwa usługi"} ·{" "}
                  {props.serviceDraft.price.trim() ? formatServicePrice(props.serviceDraft.price) : "0 zł"} ·{" "}
                  {formatDuration(Number(props.serviceDraft.durationMinutes) || 0) || "0min"}
                </span>
                <button
                  type="button"
                  disabled={!props.canSaveService || props.isSavingService}
                  aria-busy={props.isActionPending("save_service")}
                  onClick={props.onSaveService}
                >
                  {props.editingService ? "Zapisz zmiany" : "Dodaj usługę"}
                </button>
              </div>
            </section>

            <section className="service-management-list">
              {props.services.map((service) => (
                <article className="service-management-card" key={service.id}>
                  <div>
                    <strong>{service.name}</strong>
                    <span>{service.price} · {formatDuration(service.durationMinutes)}</span>
                  </div>
                  <div className="service-management-actions">
                    <button type="button" onClick={() => props.onEditService(service)}>Edytuj</button>
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
              Imię wyświetlane
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
                  maxLength={40}
                  value={props.draft.instagram}
                  onChange={(event) => props.onChange("instagram", event.target.value.replace(/^@+/, ""))}
                  placeholder="nazwa_profilu"
                />
              </span>
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
