import { CalendarDays, BarChart3, Clock3, CircleUserRound, UsersRound } from "lucide-react";
import { timeSlots } from "./booking-selectors";
import { type BarberAdminSection, type StandaloneAdminSection, type BarberDetails, type WaitlistTimePreference, type Service, type AppointmentStatus, type AdminSection, type SmsTemplate } from "./booking-types";
import { type AppointmentMutationAction } from "./appointments";
import { type PushDeviceStatus } from "./notifications";

export const appointmentActionFeedback: Record<
  AppointmentMutationAction,
  { pending: string; success: string }
> = {
  create_client: { pending: "Rezerwuję termin…", success: "Wizyta została zarezerwowana." },
  reschedule_client: { pending: "Zmieniam termin…", success: "Nowy termin został zapisany." },
  confirm_client: { pending: "Potwierdzam termin…", success: "Termin został potwierdzony." },
  confirm_admin: { pending: "Potwierdzam wizytę…", success: "Wizyta została potwierdzona." },
  refuse_admin: { pending: "Odmawiam nowego terminu…", success: "Wizyta wróciła do poprzedniego terminu. Klient dostał prośbę o wybranie innego." },
  attend_client: { pending: "Potwierdzam obecność…", success: "Dziękujemy, barber widzi, że będziesz." },
  cancel_client: { pending: "Odwołuję wizytę…", success: "Wizyta została odwołana." },
  create_admin: { pending: "Zapisuję wizytę…", success: "Wizyta została zapisana." },
  update_admin: { pending: "Zapisuję zmiany wizyty…", success: "Zmiany wizyty zostały zapisane." },
  reschedule_admin: { pending: "Przenoszę wizytę…", success: "Termin wizyty został zmieniony." },
  cancel_admin: { pending: "Odwołuję wizytę…", success: "Wizyta została odwołana." },
  settle_admin: { pending: "Rozliczam wizytę…", success: "Wizyta została rozliczona." },
  mark_no_show_admin: { pending: "Zapisuję nieobecność…", success: "Nieobecność została zapisana." },
  upsert_admin_client: { pending: "Zapisuję dane klienta…", success: "Dane klienta zostały zapisane." },
  merge_admin_clients: { pending: "Łączę karty klientów…", success: "Karty zostały scalone. Historia jest przypisana do wybranego konta." },
  hide_admin_client: { pending: "Aktualizuję kartotekę…", success: "Kartoteka została zaktualizowana." },
  delete_admin_client: { pending: "Usuwam klienta…", success: "Klient został usunięty." },
  join_waitlist: { pending: "Zapisuję na listę rezerwową…", success: "Zapisano na listę rezerwową." },
  leave_waitlist: { pending: "Usuwam zapis z listy…", success: "Zapis został usunięty." },
  remove_waitlist_admin: { pending: "Usuwam osobę z listy…", success: "Osoba została usunięta z listy." },
};

export const barberAdminSections: BarberAdminSection[] = [
  "schedule",
  "clients",
  "analytics",
  "work",
  "services",
  "profile",
];

export const standaloneAdminSections: StandaloneAdminSection[] = ["analytics", "work", "profile"];

export const fullBarberAccess: Record<BarberAdminSection, boolean> = {
  schedule: true,
  clients: true,
  analytics: true,
  work: true,
  services: true,
  profile: true,
};

export const noBarberAccess: Record<BarberAdminSection, boolean> = {
  schedule: false,
  clients: false,
  analytics: false,
  work: false,
  services: false,
  profile: false,
};

export const emptyBarberDetails: BarberDetails = {
  displayName: "",
  phone: "",
  email: "",
  instagram: "",
  bio: "",
  photoUrl: "",
};

export const waitlistTimePreferenceLabels: Record<WaitlistTimePreference, string> = {
  any: "Dowolna pora",
  morning: "Rano · do 12:00",
  afternoon: "Popołudnie · 12:00–17:00",
  evening: "Wieczór · od 17:00",
};

/** The time-of-day buttons of the waitlist form, laid out like the barber's hour presets. */
export const waitlistTimeChoices: { id: WaitlistTimePreference; label: string; hours: string }[] = [
  { id: "any", label: "Dowolna", hours: "cały dzień" },
  { id: "morning", label: "Rano", hours: "do 12:00" },
  { id: "afternoon", label: "Popołudnie", hours: "12:00–17:00" },
  { id: "evening", label: "Wieczór", hours: "od 17:00" },
];

export const unavailableService: Service = {
  id: "",
  barberId: "",
  name: "Brak dostępnej usługi",
  price: "",
  durationMinutes: 30,
  order: 0,
};

export const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  confirmed: "Potwierdzona",
  rescheduled: "Przesunięta",
  cancelled: "Odwołana",
  completed: "Rozliczona",
  no_show: "Nieobecność",
};

export const adminSectionLabels: Record<AdminSection, string> = {
  schedule: "Terminy",
  analytics: "Analiza",
  work: "Praca",
  profile: "Profil",
  team: "Zespół",
};

export const teamAccessLabels: Record<BarberAdminSection, string> = {
  schedule: "Terminarz",
  clients: "Baza klientów",
  analytics: "Analiza",
  work: "Praca",
  services: "Usługi",
  profile: "Profil",
};

export const adminNavigationLabels: Record<AdminSection, string> = {
  schedule: "Terminy",
  analytics: "Analiza",
  work: "Praca",
  profile: "Profil",
  team: "Zespół",
};

export const adminNavigationIcons = {
  schedule: CalendarDays,
  analytics: BarChart3,
  work: Clock3,
  profile: CircleUserRound,
  team: UsersRound,
} satisfies Record<AdminSection, typeof CalendarDays>;

export const smsTemplateLabels: Record<SmsTemplate, string> = {
  confirmation: "Potwierdzenie",
  reschedule: "Zmiana terminu",
  reminder: "Przypomnienie",
  custom: "Własna",
};

export const workTimeOptions = timeSlots;

export const pushDeviceStatusLabel: Record<PushDeviceStatus, string> = {
  checking: "Sprawdzanie powiadomień",
  enabled: "Powiadomienia włączone na tym urządzeniu",
  disabled: "Powiadomienia wyłączone na tym urządzeniu",
  blocked: "Powiadomienia zablokowane w ustawieniach urządzenia",
  unsupported: "Powiadomienia niedostępne na tym urządzeniu",
  error: "Nie udało się sprawdzić powiadomień",
};
