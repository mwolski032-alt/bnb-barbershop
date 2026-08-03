"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { onValue, ref, remove, set, update } from "firebase/database";

import { firebaseApp, realtimeDb } from "./lib/firebase";

type Availability = "high" | "medium" | "low" | "none";
type Step = "booking" | "confirm" | "success" | "admin";
type AdminSection = "schedule" | "clients" | "work";

type Service = {
  id: string;
  name: string;
  price: string;
  durationMinutes: number;
};

type Appointment = {
  id: string;
  dateKey: string;
  startTime: string;
  durationMinutes: number;
};

type DayCell = {
  date: Date;
  day: number;
  monthOffset: -1 | 0 | 1;
  availability: Availability;
  freeSlots: number;
  totalSlots: number;
};

type FormState = {
  fullName: string;
  phone: string;
};

type BookingSummary = {
  serviceName: string;
  servicePrice: string;
  durationMinutes: number;
  date: Date;
  time: string;
  fullName: string;
  phone: string;
};

type AdminAppointment = Appointment & {
  clientName: string;
  clientEmail?: string;
  clientPhotoUrl?: string;
  phone?: string;
  userId?: string;
  serviceName: string;
  price: string;
  color: "blue" | "mint";
};

type AvailabilityWindow = {
  id: string;
  dateKey: string;
  startTime: string;
  endTime: string;
};

type WorkSettings = {
  availability: Record<string, AvailabilityWindow>;
};

type AuthUser = Pick<User, "uid" | "displayName" | "email" | "photoURL">;

const services: Service[] = [
  {
    id: "mens-haircut",
    name: "Strzyżenie męskie",
    price: "30 zł",
    durationMinutes: 90,
  },
  {
    id: "beard-trim",
    name: "Trymowanie brody",
    price: "20 zł",
    durationMinutes: 60,
  },
];

const workdayStartMinutes = 8 * 60;
const workdayEndMinutes = 16 * 60;
const monthFormatter = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" });
const selectedDayFormatter = new Intl.DateTimeFormat("pl-PL", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dayFormatter = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" });
const adminClientDateFormatter = new Intl.DateTimeFormat("pl-PL", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
});

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

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

const addMinutesToTime = (time: string, minutes: number) =>
  minutesToTime(timeToMinutes(time) + minutes);

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return [hours > 0 ? `${hours}g` : "", remainingMinutes > 0 ? `${remainingMinutes}min` : ""]
    .filter(Boolean)
    .join(" ");
};

const getPhoneDigits = (value: string) => value.replace(/\D/g, "").slice(0, 9);

const formatPhoneNumber = (value: string) => {
  const digits = getPhoneDigits(value);
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)]
    .filter(Boolean)
    .join(" ");
};

const buildTimeSlots = (startHour = 6, endHour = 22) => {
  const slots: string[] = [];

  for (let hour = startHour; hour <= endHour; hour += 1) {
    for (let minute = 0; minute < 60; minute += 15) {
      if (hour === endHour && minute > 0) continue;
      slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    }
  }

  return slots;
};

const timeSlots = buildTimeSlots();
const workTimeOptions = timeSlots;
const defaultWorkSettings: WorkSettings = {
  availability: {},
};

const rangesOverlap = (
  startA: number,
  durationA: number,
  startB: number,
  durationB: number,
) => startA < startB + durationB && startA + durationA > startB;

const normalizeWorkSettings = (value: Partial<WorkSettings> | null): WorkSettings => ({
  availability: value?.availability ?? {},
});

const getAvailabilityForDate = (dateKeyValue: string, settings: WorkSettings) =>
  settings.availability[dateKeyValue] ?? null;

const getDateKeysInRange = (startKey: string, endKey: string) => {
  const startDate = dateFromKey(startKey <= endKey ? startKey : endKey);
  const endDate = dateFromKey(startKey <= endKey ? endKey : startKey);
  const keys: string[] = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    keys.push(dayKey(current));
    current.setDate(current.getDate() + 1);
  }

  return keys;
};

const formatWorkRange = (settings: AvailabilityWindow | null) =>
  settings ? `${settings.startTime} - ${settings.endTime}` : "Niedostępny";

const isTimeAvailable = (
  dateKeyValue: string,
  time: string,
  durationMinutes: number,
  appointments: Appointment[],
  workSettings: WorkSettings,
) => {
  const availabilityWindow = getAvailabilityForDate(dateKeyValue, workSettings);
  const startMinutes = timeToMinutes(time);

  if (!availabilityWindow) return false;
  if (
    startMinutes < timeToMinutes(availabilityWindow.startTime) ||
    startMinutes + durationMinutes > timeToMinutes(availabilityWindow.endTime)
  ) {
    return false;
  }

  return !appointments.some(
    (appointment) =>
      appointment.dateKey === dateKeyValue &&
      rangesOverlap(
        startMinutes,
        durationMinutes,
        timeToMinutes(appointment.startTime),
        appointment.durationMinutes,
      ),
  );
};

const getAvailableTimes = (
  dateKeyValue: string,
  durationMinutes: number,
  appointments: Appointment[],
  workSettings: WorkSettings,
) =>
  timeSlots.filter((time) =>
    isTimeAvailable(dateKeyValue, time, durationMinutes, appointments, workSettings),
  );

const availabilityFromSlots = (freeSlots: number, totalSlots: number): Availability => {
  if (freeSlots === 0 || totalSlots === 0) return "none";
  const ratio = freeSlots / totalSlots;
  if (ratio <= 0.25) return "low";
  if (ratio <= 0.6) return "medium";
  return "high";
};

const buildCalendarDays = (
  visibleMonth: Date,
  service: Service,
  appointments: Appointment[],
  workSettings: WorkSettings,
  today: Date,
): DayCell[] => {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const calendarStart = new Date(year, month, 1 - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setDate(calendarStart.getDate() + index);
    const normalizedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const isPastDay = normalizedDate < normalizedToday;
    const totalSlots = isPastDay
      ? 0
      : getAvailableTimes(dayKey(date), service.durationMinutes, [], workSettings).length;
    const freeSlots = isPastDay
      ? 0
      : getAvailableTimes(
          dayKey(date),
          service.durationMinutes,
          appointments,
          workSettings,
        ).length;

    return {
      date,
      day: date.getDate(),
      monthOffset: date.getMonth() === month ? 0 : date < firstDay ? -1 : 1,
      availability: availabilityFromSlots(freeSlots, totalSlots),
      freeSlots,
      totalSlots,
    };
  });
};

const availabilityLabel: Record<Availability, string> = {
  high: "Dużo wolnych godzin",
  medium: "Średnia dostępność",
  low: "Bardzo mało godzin",
  none: "Brak terminów",
};

export function BookingHome() {
  const today = useMemo(() => new Date(), []);
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isTestMode, setIsTestMode] = useState(false);
  const [authError, setAuthError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [step, setStep] = useState<Step>("booking");
  const [adminSection, setAdminSection] = useState<AdminSection>("schedule");
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedKey, setSelectedKey] = useState(() => dayKey(today));
  const [adminSelectedKey, setAdminSelectedKey] = useState(() => dayKey(today));
  const [selectedServiceId, setSelectedServiceId] = useState(services[0].id);
  const [selectedTime, setSelectedTime] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [adminAppointments, setAdminAppointments] = useState<AdminAppointment[]>([]);
  const [workSettings, setWorkSettings] = useState<WorkSettings>(defaultWorkSettings);
  const [form, setForm] = useState<FormState>({ fullName: "", phone: "" });
  const [bookingSummary, setBookingSummary] = useState<BookingSummary | null>(null);
  const [successReady, setSuccessReady] = useState(false);
  const [draggedAppointmentId, setDraggedAppointmentId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [availabilityDraft, setAvailabilityDraft] = useState(() => ({
    start: dayKey(today),
    end: dayKey(today),
    startTime: "10:00",
    endTime: "13:00",
  }));

  const selectedService = services.find((item) => item.id === selectedServiceId) ?? services[0];
  const days = useMemo(
    () => buildCalendarDays(visibleMonth, selectedService, appointments, workSettings, today),
    [appointments, selectedService, visibleMonth, workSettings, today],
  );
  const selectedDay =
    days.find((day) => dayKey(day.date) === selectedKey) ??
    days.find((day) => day.monthOffset === 0) ??
    days[0];
  const selectedDayKey = dayKey(selectedDay.date);
  const activeUser = useMemo<AuthUser | null>(
    () =>
      currentUser ??
      (isTestMode
        ? {
            uid: "test-user",
            displayName: "Tryb testowy",
            email: "test@bnb.local",
            photoURL: null,
          }
        : null),
    [currentUser, isTestMode],
  );
  const adminAppointmentDays = useMemo(
    () =>
      Array.from(new Set(adminAppointments.map((appointment) => appointment.dateKey))).sort(
        (first, second) => first.localeCompare(second),
      ),
    [adminAppointments],
  );
  const adminDayAppointments = useMemo(
    () =>
      adminAppointments
        .filter((appointment) => appointment.dateKey === adminSelectedKey)
        .sort((first, second) => timeToMinutes(first.startTime) - timeToMinutes(second.startTime)),
    [adminAppointments, adminSelectedKey],
  );
  const adminDayAvailability = getAvailabilityForDate(adminSelectedKey, workSettings);
  const adminScheduleStartMinutes = adminDayAvailability
    ? Math.floor(timeToMinutes(adminDayAvailability.startTime) / 60) * 60
    : workdayStartMinutes;
  const adminScheduleEndMinutes = adminDayAvailability
    ? Math.ceil(timeToMinutes(adminDayAvailability.endTime) / 60) * 60
    : workdayEndMinutes;
  const adminScheduleSlots = timeSlots.filter((time) => {
    const minutes = timeToMinutes(time);
    return minutes >= adminScheduleStartMinutes && minutes < adminScheduleEndMinutes;
  });
  const adminScheduleHours = Array.from(
    { length: Math.max(1, (adminScheduleEndMinutes - adminScheduleStartMinutes) / 60) },
    (_, index) => minutesToTime(adminScheduleStartMinutes + index * 60),
  );
  const adminClientAppointments = useMemo(
    () =>
      [...adminAppointments].sort((first, second) => {
        if (first.dateKey !== second.dateKey) return first.dateKey.localeCompare(second.dateKey);
        return timeToMinutes(first.startTime) - timeToMinutes(second.startTime);
      }),
    [adminAppointments],
  );
  const availableTimes = useMemo(
    () =>
      getAvailableTimes(
        selectedDayKey,
        selectedService.durationMinutes,
        appointments,
        workSettings,
      ),
    [appointments, selectedDayKey, selectedService, workSettings],
  );
  const canContinue = Boolean(selectedServiceId && selectedKey && selectedTime);
  const canConfirm =
    Boolean(activeUser) && form.fullName.trim().length >= 3 && getPhoneDigits(form.phone).length === 9;
  const availabilityWindows = Object.values(workSettings.availability)
    .filter((windowItem) => windowItem.dateKey >= dayKey(today))
    .sort((first, second) => {
      if (first.dateKey !== second.dateKey) return first.dateKey.localeCompare(second.dateKey);
      return timeToMinutes(first.startTime) - timeToMinutes(second.startTime);
    });
  const nearestAvailability = availabilityWindows[0] ?? null;
  const nextSaturdayOffset = (6 - today.getDay() + 7) % 7 || 7;

  useEffect(() => {
    const firebaseAuth = getAuth(firebaseApp);

    return onAuthStateChanged(firebaseAuth, (user) => {
      setCurrentUser(user);
      setAuthReady(true);

      if (user?.displayName) {
        setForm((current) => ({
          ...current,
          fullName: current.fullName || user.displayName || "",
        }));
      }
    });
  }, []);

  useEffect(() => {
    if (!activeUser) {
      setAppointments([]);
      setAdminAppointments([]);
      return undefined;
    }

    const appointmentsRef = ref(realtimeDb, "appointments");

    return onValue(appointmentsRef, (snapshot) => {
      const value = snapshot.val() as Record<string, AdminAppointment> | null;
      const loadedAppointments = Object.entries(value ?? {})
        .map(([id, appointment]) => ({
          ...appointment,
          id: appointment.id ?? id,
        }))
        .sort((first, second) => {
          if (first.dateKey !== second.dateKey) return first.dateKey.localeCompare(second.dateKey);
          return timeToMinutes(first.startTime) - timeToMinutes(second.startTime);
        });

      setAdminAppointments(loadedAppointments);
      setAppointments(
        loadedAppointments.map(({ id, dateKey, startTime, durationMinutes }) => ({
          id,
          dateKey,
          startTime,
          durationMinutes,
        })),
      );
    });
  }, [activeUser]);

  useEffect(() => {
    if (!activeUser) {
      setWorkSettings(defaultWorkSettings);
      return undefined;
    }

    const workSettingsRef = ref(realtimeDb, "workSettings");

    return onValue(workSettingsRef, (snapshot) => {
      setWorkSettings(normalizeWorkSettings(snapshot.val() as Partial<WorkSettings> | null));
    });
  }, [activeUser]);

  useEffect(() => {
    if (selectedTime && !availableTimes.includes(selectedTime)) {
      setSelectedTime("");
    }
  }, [availableTimes, selectedTime]);

  useEffect(() => {
    if (adminAppointmentDays.length === 0) return;
    if (!adminAppointmentDays.includes(adminSelectedKey)) {
      setAdminSelectedKey(adminAppointmentDays[0]);
    }
  }, [adminAppointmentDays, adminSelectedKey]);

  useEffect(() => {
    if (step !== "success") return undefined;
    setSuccessReady(false);
    const timer = window.setTimeout(() => setSuccessReady(true), 3000);
    return () => window.clearTimeout(timer);
  }, [step]);

  const shiftMonth = (direction: -1 | 1) => {
    setVisibleMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + direction, 1),
    );
  };

  const updateForm = (field: keyof FormState, value: string) => {
    setForm((current) => ({
      ...current,
      [field]: field === "phone" ? formatPhoneNumber(value) : value,
    }));
  };

  const updateAvailabilityDraft = (
    field: keyof typeof availabilityDraft,
    value: string,
  ) => {
    setAvailabilityDraft((current) => {
      const nextDraft = { ...current, [field]: value };

      if (field === "start" && nextDraft.end < value) {
        nextDraft.end = value;
      }

      if (timeToMinutes(nextDraft.startTime) >= timeToMinutes(nextDraft.endTime)) {
        nextDraft.endTime = minutesToTime(
          Math.min(timeToMinutes(nextDraft.startTime) + 15, timeToMinutes("22:00")),
        );
      }

      return nextDraft;
    });
  };

  const addAvailabilityRange = () => {
    const availabilityUpdates = Object.fromEntries(
      getDateKeysInRange(availabilityDraft.start, availabilityDraft.end).map((key) => [
        key,
        {
          id: key,
          dateKey: key,
          startTime: availabilityDraft.startTime,
          endTime: availabilityDraft.endTime,
        },
      ]),
    );

    void update(ref(realtimeDb, "workSettings/availability"), availabilityUpdates);
  };

  const removeAvailabilityDate = (dateKeyValue: string) => {
    void remove(ref(realtimeDb, `workSettings/availability/${dateKeyValue}`));
  };

  const quickAddAvailability = (offset: number, startTime: string, endTime: string) => {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    const key = dayKey(date);

    void set(ref(realtimeDb, `workSettings/availability/${key}`), {
      id: key,
      dateKey: key,
      startTime,
      endTime,
    });
  };

  const handleGoogleSignIn = async () => {
    setAuthError("");
    setIsTestMode(false);
    setIsSigningIn(true);

    try {
      const firebaseAuth = getAuth(firebaseApp);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(firebaseAuth, provider);
    } catch (error) {
      const errorCode = (error as { code?: string }).code;
      if (errorCode !== "auth/popup-closed-by-user") {
        setAuthError("Nie udało się zalogować. Spróbuj ponownie.");
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    setAuthError("");
    if (currentUser) {
      await signOut(getAuth(firebaseApp));
    }
    setIsTestMode(false);
    setStep("booking");
    setSelectedTime("");
    setBookingSummary(null);
  };

  const canMoveAdminAppointment = (
    appointment: AdminAppointment,
    startTime: string,
    targetDateKey = adminSelectedKey,
  ) => {
    const targetAvailability = getAvailabilityForDate(targetDateKey, workSettings);
    const startMinutes = timeToMinutes(startTime);
    if (
      !targetAvailability ||
      startMinutes < timeToMinutes(targetAvailability.startTime) ||
      startMinutes + appointment.durationMinutes > timeToMinutes(targetAvailability.endTime)
    ) {
      return false;
    }

    return !adminAppointments.some(
      (otherAppointment) =>
        otherAppointment.id !== appointment.id &&
        otherAppointment.dateKey === targetDateKey &&
        rangesOverlap(
          startMinutes,
          appointment.durationMinutes,
          timeToMinutes(otherAppointment.startTime),
          otherAppointment.durationMinutes,
        ),
    );
  };

  const confirmBooking = async () => {
    if (!canConfirm || !selectedTime || isSaving || !activeUser) return;

    const appointmentId = window.crypto?.randomUUID?.() ?? `${Date.now()}`;
    const appointmentColor = selectedService.id === "mens-haircut" ? "blue" : "mint";
    const adminAppointment: AdminAppointment = {
      id: appointmentId,
      userId: activeUser.uid,
      dateKey: selectedDayKey,
      startTime: selectedTime,
      durationMinutes: selectedService.durationMinutes,
      clientName: form.fullName.trim(),
      clientEmail: activeUser.email ?? "",
      clientPhotoUrl: activeUser.photoURL ?? "",
      phone: form.phone,
      serviceName: selectedService.name,
      price: selectedService.price,
      color: appointmentColor,
    };

    setBookingSummary({
      serviceName: selectedService.name,
      servicePrice: selectedService.price,
      durationMinutes: selectedService.durationMinutes,
      date: selectedDay.date,
      time: selectedTime,
      fullName: form.fullName.trim(),
      phone: form.phone,
    });
    try {
      setIsSaving(true);
      await set(ref(realtimeDb, `appointments/${appointmentId}`), adminAppointment);
      setForm({ fullName: "", phone: "" });
      setStep("success");
    } finally {
      setIsSaving(false);
    }
  };

  const moveAdminAppointment = (appointmentId: string, startTime: string) => {
    const appointment = adminAppointments.find((item) => item.id === appointmentId);
    if (!appointment || !canMoveAdminAppointment(appointment, startTime)) {
      setDraggedAppointmentId(null);
      return;
    }

    void update(ref(realtimeDb, `appointments/${appointmentId}`), {
      dateKey: adminSelectedKey,
      startTime,
    });
    setDraggedAppointmentId(null);
  };

  const shiftAdminAppointment = (appointmentId: string, minutes: -15 | 15) => {
    const appointment = adminAppointments.find((item) => item.id === appointmentId);
    if (!appointment) return;

    moveAdminAppointment(
      appointmentId,
      minutesToTime(timeToMinutes(appointment.startTime) + minutes),
    );
  };

  const declineAdminAppointment = (appointmentId: string) => {
    void remove(ref(realtimeDb, `appointments/${appointmentId}`));
  };

  const footerLabel = step === "booking" ? "Dalej" : step === "confirm" ? "Potwierdź" : "Gotowe";
  const footerDisabled =
    step === "booking" ? !canContinue : step === "confirm" ? !canConfirm || isSaving : !successReady;
  const footerClassName = `bottom-action ${step === "confirm" && canConfirm ? "ready" : ""}`;

  if (!authReady) {
    return (
      <main className="auth-shell" aria-label="Ładowanie logowania">
        <section className="auth-card">
          <div className="auth-brand">
            <span className="auth-logo" aria-hidden="true">
              B
            </span>
            <p>BNB Barbershop</p>
          </div>
          <div className="auth-loader" aria-hidden="true" />
          <h1>Sprawdzamy sesję</h1>
          <p className="auth-copy">Za chwilę pokażemy rezerwacje albo ekran logowania.</p>
        </section>
      </main>
    );
  }

  if (!activeUser) {
    return (
      <main className="auth-shell" aria-label="Logowanie do aplikacji">
        <section className="auth-card">
          <div className="auth-brand">
            <span className="auth-logo" aria-hidden="true">
              B
            </span>
            <p>BNB Barbershop</p>
          </div>

          <div className="auth-hero">
            <p className="eyebrow">Rezerwacje online</p>
            <h1>Zaloguj się, żeby umówić wizytę</h1>
            <p className="auth-copy">
              Po zalogowaniu przypiszemy wizytę do Twojego konta. Dzięki temu później
              będziesz mógł wrócić do swoich rezerwacji.
            </p>
          </div>

          <div className="auth-benefits" aria-label="Co daje logowanie">
            <span>Twoje terminy w jednym miejscu</span>
            <span>Łatwiejsze przesunięcie wizyty</span>
            <span>Bez podglądu cudzych rezerwacji</span>
          </div>

          <button
            className="google-login-button"
            type="button"
            onClick={() => {
              void handleGoogleSignIn();
            }}
            disabled={isSigningIn}
          >
            <span aria-hidden="true">G</span>
            {isSigningIn ? "Łączenie..." : "Kontynuuj z Google"}
          </button>

          <button
            className="test-login-button"
            type="button"
            onClick={() => {
              setAuthError("");
              setIsTestMode(true);
              setForm((current) => ({
                ...current,
                fullName: current.fullName || "Tryb testowy",
              }));
            }}
          >
            Wejdź testowo
          </button>

          {authError ? <p className="auth-error">{authError}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main
      className={`app-shell ${step === "confirm" || step === "success" ? "confirm-page" : ""} ${
        step === "admin" ? "admin-page" : ""
      }`}
    >
      {step === "admin" ? (
        <section className="admin-view" aria-label="Panel admina">
          <div className="admin-topbar">
            <button className="back-button" type="button" onClick={() => setStep("booking")}>
              ‹ Wróć
            </button>
            <div>
              <p className="eyebrow">Admin</p>
              <h1>
                {adminSection === "schedule"
                  ? "Terminarz"
                  : adminSection === "clients"
                    ? "Klienci"
                    : "Praca"}
              </h1>
            </div>
          </div>

          <div className="admin-content-frame">
            <div className={`admin-tab-panel ${adminSection === "schedule" ? "active" : ""}`}>
              <div className="admin-days" aria-label="Dni z wizytami">
                {adminAppointmentDays.length > 0 ? (
                  adminAppointmentDays.map((key) => {
                    const date = dateFromKey(key);
                    const appointmentsCount = adminAppointments.filter(
                      (appointment) => appointment.dateKey === key,
                    ).length;

                    return (
                      <button
                        className={key === adminSelectedKey ? "active" : ""}
                        key={key}
                        type="button"
                        onClick={() => setAdminSelectedKey(key)}
                      >
                        <span>
                          {new Intl.DateTimeFormat("pl-PL", { weekday: "short" })
                            .format(date)
                            .replace(".", "")}
                        </span>
                        <strong>{String(date.getDate()).padStart(2, "0")}</strong>
                        <small>
                          {new Intl.DateTimeFormat("pl-PL", { month: "short" })
                            .format(date)
                            .replace(".", "")}
                          {" - "}
                          {appointmentsCount}
                        </small>
                      </button>
                    );
                  })
                ) : (
                  <p className="admin-days-empty">Brak zaplanowanych wizyt.</p>
                )}
              </div>

          <div className="client-strip" aria-label="Klienci z wybranego dnia">
            {adminDayAppointments.length > 0 ? (
              adminDayAppointments.map((appointment) => (
                <button className="client-chip" key={appointment.id} type="button">
                  <span>{appointment.clientName.slice(0, 1)}</span>
                  <strong>{appointment.clientName}</strong>
                  <small>{appointment.startTime}</small>
                </button>
              ))
            ) : (
              <p>Brak klientów w tym dniu.</p>
            )}
          </div>

          <div
            className="admin-schedule"
            style={{ height: `${Math.max(8, adminScheduleSlots.length) * 2.8 + 1.5}rem` }}
          >
            {adminDayAppointments.length === 0 ? (
              <p className="admin-empty-state">Brak wizyt w tym dniu.</p>
            ) : null}
            <div
              className="time-axis"
              aria-hidden="true"
              style={{ gridTemplateRows: `repeat(${adminScheduleHours.length}, 11.2rem)` }}
            >
              {adminScheduleHours.map((time) => (
                <span key={time}>{time}</span>
              ))}
            </div>

            <div className="schedule-column">
              {adminScheduleSlots.map((time) => (
                <div
                  className="schedule-drop-zone"
                  key={time}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (draggedAppointmentId) moveAdminAppointment(draggedAppointmentId, time);
                  }}
                />
              ))}

              {adminDayAppointments.map((appointment) => {
                const top =
                  ((timeToMinutes(appointment.startTime) - adminScheduleStartMinutes) / 15) * 2.8;
                const height = Math.max(4.8, (appointment.durationMinutes / 15) * 2.8 - 0.35);

                return (
                  <article
                    className={`admin-appointment ${appointment.color}`}
                    draggable
                    key={appointment.id}
                    onDragStart={() => setDraggedAppointmentId(appointment.id)}
                    style={{ top: `${top}rem`, height: `${height}rem` }}
                  >
                    <div>
                      <strong>
                        {appointment.startTime} -{" "}
                        {addMinutesToTime(appointment.startTime, appointment.durationMinutes)}
                      </strong>
                      <span>
                        {appointment.clientName} · {appointment.serviceName}
                      </span>
                    </div>
                    <div className="appointment-actions">
                      <button
                        type="button"
                        onClick={() => shiftAdminAppointment(appointment.id, -15)}
                        disabled={
                          !canMoveAdminAppointment(
                            appointment,
                            minutesToTime(timeToMinutes(appointment.startTime) - 15),
                          )
                        }
                        aria-label={`Cofnij wizytę ${appointment.clientName} o 15 minut`}
                      >
                        -15
                      </button>
                      <button
                        type="button"
                        onClick={() => shiftAdminAppointment(appointment.id, 15)}
                        disabled={
                          !canMoveAdminAppointment(
                            appointment,
                            minutesToTime(timeToMinutes(appointment.startTime) + 15),
                          )
                        }
                        aria-label={`Przesuń wizytę ${appointment.clientName} o 15 minut`}
                      >
                        +15
                      </button>
                      <button
                        className="decline-button"
                        type="button"
                        onClick={() => declineAdminAppointment(appointment.id)}
                        aria-label={`Odmów wizytę ${appointment.clientName}`}
                      >
                        Odmów
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
            </div>

            <div className={`admin-tab-panel ${adminSection === "clients" ? "active" : ""}`}>
              <div className="clients-view" aria-label="Lista klientów">
                {adminClientAppointments.length > 0 ? (
                  adminClientAppointments.map((appointment) => {
                    const phoneDigits = getPhoneDigits(appointment.phone ?? "");
                    const hasPhone = phoneDigits.length === 9;

                    return (
                      <article className="client-row" key={appointment.id}>
                        <div className="client-row-avatar">
                          {appointment.clientName.slice(0, 1)}
                        </div>
                        <div className="client-row-main">
                          <strong>{appointment.clientName}</strong>
                          <span>
                            {adminClientDateFormatter.format(dateFromKey(appointment.dateKey))},{" "}
                            {appointment.startTime} · {appointment.serviceName}
                          </span>
                          <small>{hasPhone ? formatPhoneNumber(phoneDigits) : "Brak numeru"}</small>
                        </div>
                        {hasPhone ? (
                          <a
                            className="sms-button"
                            href={`sms:${phoneDigits}`}
                            aria-label={`Wyślij SMS do ${appointment.clientName}`}
                          >
                            💬
                          </a>
                        ) : (
                          <span className="sms-button disabled" aria-label="Brak numeru telefonu">
                            💬
                          </span>
                        )}
                      </article>
                    );
                  })
                ) : (
                  <p className="clients-empty-state">Brak klientów do wyświetlenia.</p>
                )}
              </div>
            </div>

            <div className={`admin-tab-panel ${adminSection === "work" ? "active" : ""}`}>
              <div className="work-view casual" aria-label="Moja dostępność">
                <section className="work-hero casual">
                  <div>
                    <p className="eyebrow">Dorywczo</p>
                    <h2>Moja dostępność</h2>
                  </div>
                  <div className="work-metrics" aria-label="Skrót pracy">
                    <span>
                      <strong>{availabilityWindows.length}</strong>
                      dostępne
                    </span>
                    <span>
                      <strong>{nearestAvailability?.startTime ?? "—"}</strong>
                      najbliżej
                    </span>
                  </div>
                </section>

                <section className="work-editor-card availability-maker">
                  <div className="work-editor-top">
                    <div>
                      <p className="eyebrow">Nowa dostępność</p>
                      <h2>Okienko w kalendarzu</h2>
                    </div>
                  </div>

                  <div className="work-preset-grid">
                    {[
                      { label: "Po pracy", startTime: "17:00", endTime: "20:00" },
                      { label: "Wolne rano", startTime: "10:00", endTime: "13:00" },
                      { label: "Krótko", startTime: "18:00", endTime: "19:30" },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          setAvailabilityDraft((current) => ({
                            ...current,
                            startTime: preset.startTime,
                            endTime: preset.endTime,
                          }))
                        }
                      >
                        <strong>{preset.label}</strong>
                        <span>
                          {preset.startTime} - {preset.endTime}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="work-time-controls pro">
                    <label>
                      Od daty
                      <input
                        type="date"
                        value={availabilityDraft.start}
                        onChange={(event) =>
                          updateAvailabilityDraft("start", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Do daty
                      <input
                        type="date"
                        value={availabilityDraft.end}
                        onChange={(event) => updateAvailabilityDraft("end", event.target.value)}
                      />
                    </label>
                    <label>
                      Od godziny
                      <select
                        value={availabilityDraft.startTime}
                        onChange={(event) =>
                          updateAvailabilityDraft("startTime", event.target.value)
                        }
                      >
                        {workTimeOptions.slice(0, -1).map((time) => (
                          <option key={time} value={time}>
                            {time}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Do godziny
                      <select
                        value={availabilityDraft.endTime}
                        onChange={(event) =>
                          updateAvailabilityDraft("endTime", event.target.value)
                        }
                      >
                        {workTimeOptions.slice(1).map((time) => (
                          <option key={time} value={time}>
                            {time}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="availability-summary-panel">
                    <span>
                      Dodasz {getDateKeysInRange(availabilityDraft.start, availabilityDraft.end).length}{" "}
                      {getDateKeysInRange(availabilityDraft.start, availabilityDraft.end).length === 1
                        ? "dzień"
                        : "dni"}{" "}
                      od {availabilityDraft.startTime} do {availabilityDraft.endTime}
                    </span>
                    <button type="button" onClick={addAvailabilityRange}>
                      Dodaj dostępność
                    </button>
                  </div>
                </section>

                <section className="work-editor-card">
                  <div className="work-editor-top">
                    <div>
                      <p className="eyebrow">Szybkie dodawanie</p>
                      <h2>Gotowe okienka</h2>
                    </div>
                  </div>

                  <div className="quick-availability-list">
                    <button type="button" onClick={() => quickAddAvailability(1, "17:00", "20:00")}>
                      <strong>Jutro</strong>
                      <span>17:00 - 20:00</span>
                    </button>
                    <button type="button" onClick={() => quickAddAvailability(2, "10:00", "13:00")}>
                      <strong>Za 2 dni</strong>
                      <span>10:00 - 13:00</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => quickAddAvailability(nextSaturdayOffset, "09:00", "14:00")}
                    >
                      <strong>Weekend</strong>
                      <span>09:00 - 14:00</span>
                    </button>
                  </div>
                </section>

                <section className="availability-list-card">
                  <div className="work-card-heading">
                    <div>
                      <p className="eyebrow">Widoczne dla klientów</p>
                      <h2>Aktywne dni</h2>
                    </div>
                  </div>

                  <div className="availability-window-list">
                    {availabilityWindows.length > 0 ? (
                      availabilityWindows.map((windowItem) => (
                        <article className="availability-window-row" key={windowItem.id}>
                          <div>
                            <strong>
                              {adminClientDateFormatter.format(dateFromKey(windowItem.dateKey))}
                            </strong>
                            <span>{formatWorkRange(windowItem)}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeAvailabilityDate(windowItem.dateKey)}
                          >
                            Usuń
                          </button>
                        </article>
                      ))
                    ) : (
                      <p>Nie masz jeszcze żadnego dostępnego dnia.</p>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>

          <nav className="admin-bottom-nav" aria-label="Sekcje admina">
            <span className={`admin-nav-pill ${adminSection}`} aria-hidden="true" />
            <button
              className={adminSection === "schedule" ? "active" : ""}
              type="button"
              onClick={() => setAdminSection("schedule")}
            >
              Terminarz
            </button>
            <button
              className={adminSection === "clients" ? "active" : ""}
              type="button"
              onClick={() => setAdminSection("clients")}
            >
              Klienci
            </button>
            <button
              className={adminSection === "work" ? "active" : ""}
              type="button"
              onClick={() => setAdminSection("work")}
            >
              Praca
            </button>
          </nav>
        </section>
      ) : step === "booking" ? (
        <>
          <section className="booking-panel" aria-label="Kalendarz rezerwacji">
            <div className="topbar">
              <div>
                <p className="eyebrow">BNB Barbershop</p>
                <h1>Umów wizytę</h1>
              </div>
              <div className="session-pill">
                {activeUser.photoURL ? (
                  <img src={activeUser.photoURL} alt="" />
                ) : (
                  <span aria-hidden="true">{(activeUser.displayName ?? "K").slice(0, 1)}</span>
                )}
                <strong>{activeUser.displayName ?? activeUser.email ?? "Klient"}</strong>
                <button
                  type="button"
                  onClick={() => {
                    void handleSignOut();
                  }}
                >
                  Wyloguj
                </button>
              </div>
              <button
                className="avatar-button"
                type="button"
                onClick={() => setStep("admin")}
                aria-label="Otwórz profil admina"
              >
                <span className="avatar-icon" aria-hidden="true">
                  <span />
                </span>
              </button>
            </div>

            <div className="calendar-header">
              <div>
                <p className="section-label">Kalendarz</p>
                <h2>{monthFormatter.format(visibleMonth)}</h2>
              </div>
              <div className="month-controls" aria-label="Zmiana miesiąca">
                <button type="button" onClick={() => shiftMonth(-1)} aria-label="Poprzedni miesiąc">
                  ‹
                </button>
                <button type="button" onClick={() => shiftMonth(1)} aria-label="Następny miesiąc">
                  ›
                </button>
              </div>
            </div>

            <div className="weekday-row" aria-hidden="true">
              {["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>

            <div className="calendar-grid">
              {days.map((day) => {
                const key = dayKey(day.date);
                const isSelected = key === selectedDayKey;
                const isToday = key === dayKey(today);
                const progress = day.totalSlots
                  ? Math.min(100, (day.freeSlots / day.totalSlots) * 100)
                  : 0;

                return (
                  <button
                    className={`day-tile ${day.availability} ${
                      day.monthOffset === 0 ? "" : "outside-month"
                    } ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}`}
                    disabled={day.freeSlots === 0}
                    key={key}
                    type="button"
                    onClick={() => {
                      setSelectedKey(key);
                      setSelectedTime("");
                    }}
                    aria-label={`${day.day}, ${availabilityLabel[day.availability]}`}
                  >
                    <span className="day-number">{day.day}</span>
                    {isToday ? <span className="today-dot" aria-label="Dzisiaj" /> : null}
                    <span className="availability-bar">
                      <span style={{ width: `${progress}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="day-summary" aria-label="Szczegóły rezerwacji">
            <div className="summary-block">
              <p className="section-label">Wybierz usługę</p>
              <div className="service-list">
                {services.map((item) => (
                  <button
                    className={`service-card ${selectedServiceId === item.id ? "selected" : ""}`}
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedServiceId(item.id);
                      setSelectedTime("");
                    }}
                    aria-pressed={selectedServiceId === item.id}
                  >
                    <span>
                      <strong>{item.name}</strong>
                      <small>{formatDuration(item.durationMinutes)}</small>
                    </span>
                    <b>{item.price}</b>
                  </button>
                ))}
              </div>
            </div>

            <div className="summary-heading">
              <p className="section-label">Wybrany dzień</p>
              <h2>{selectedDayFormatter.format(selectedDay.date)}</h2>
            </div>

            <div className="summary-block">
              <p className="section-label">Wybierz godzinę</p>
              <div className="time-list">
                {availableTimes.length > 0 ? (
                  availableTimes.map((time) => (
                    <button
                      className={selectedTime === time ? "selected" : ""}
                      key={time}
                      type="button"
                      onClick={() => setSelectedTime(time)}
                      aria-pressed={selectedTime === time}
                    >
                      {time}
                    </button>
                  ))
                ) : (
                  <p className="empty-state">Brak wolnych godzin dla tej usługi.</p>
                )}
              </div>
            </div>
          </aside>
        </>
      ) : step === "confirm" ? (
        <section className="confirm-view" aria-label="Wypełnij i potwierdź">
          <button className="back-button" type="button" onClick={() => setStep("booking")}>
            ‹ Wróć
          </button>

          <div className="confirm-title">
            <p className="eyebrow">BNB Barbershop</p>
            <h1>Wypełnij i potwierdź</h1>
          </div>

          <div className="booking-recap" aria-label="Podsumowanie wyboru">
            <span>{selectedService.name}</span>
            <strong>{selectedService.price}</strong>
            <span>
              {dayFormatter.format(selectedDay.date)}, {selectedTime} ·{" "}
              {formatDuration(selectedService.durationMinutes)}
            </span>
          </div>

          <form className="confirm-form">
            <label>
              Imię i nazwisko
              <input
                type="text"
                value={form.fullName}
                onChange={(event) => updateForm("fullName", event.target.value)}
                autoComplete="name"
              />
            </label>
            <label>
              Numer telefonu
              <input
                type="tel"
                inputMode="numeric"
                maxLength={11}
                pattern="[0-9 ]{11}"
                value={form.phone}
                onChange={(event) => updateForm("phone", event.target.value)}
                autoComplete="tel"
              />
            </label>
          </form>
        </section>
      ) : (
        <section className="success-view" aria-label="Potwierdzenie wizyty">
          <div className="success-topbar">
            <button
              className="calendar-save-button"
              type="button"
              aria-label="Dodaj do kalendarza"
              title="Dodaj do kalendarza"
            >
              <span aria-hidden="true" />
            </button>
          </div>

          <div className={`success-loader ${successReady ? "done" : ""}`} aria-live="polite">
            <span className="loader-ring" />
            <span className="loader-check" aria-hidden="true" />
          </div>

          {successReady && bookingSummary ? (
            <div className="success-summary">
              <p className="eyebrow">Wizyta potwierdzona</p>
              <h1>{bookingSummary.serviceName}</h1>
              <div className="success-details">
                <span>{dayFormatter.format(bookingSummary.date)}</span>
                <span>{bookingSummary.time}</span>
                <span>{formatDuration(bookingSummary.durationMinutes)}</span>
                <span>{bookingSummary.servicePrice}</span>
              </div>
              <div className="client-summary">
                <span>{bookingSummary.fullName}</span>
                <span>{bookingSummary.phone}</span>
              </div>
            </div>
          ) : null}
        </section>
      )}

      {step !== "admin" ? (
        <footer className="bottom-footer" aria-label="Akcja rezerwacji">
          <button
            className={footerClassName}
            type="button"
            disabled={footerDisabled}
            onClick={() => {
              if (step === "booking") {
                setStep("confirm");
                return;
              }

              if (step === "confirm") {
                void confirmBooking();
                return;
              }

              setSelectedTime("");
              setBookingSummary(null);
              setStep("booking");
            }}
          >
            {footerLabel}
          </button>
        </footer>
      ) : null}
    </main>
  );
}
