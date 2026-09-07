import type { User } from "firebase/auth";

export type Availability = "high" | "medium" | "low" | "none";

export type Step = "booking" | "confirm" | "success" | "admin";

export type BarberAdminSection =
  | "schedule"
  | "clients"
  | "analytics"
  | "work"
  | "services"
  | "profile";

export type AdminSection = Exclude<BarberAdminSection, "clients" | "services"> | "team";

export type StandaloneAdminSection = Exclude<
  BarberAdminSection,
  "schedule" | "clients" | "services"
>;

export type AdminWorkspaceTab = "upcoming" | "schedule" | "clients";

export type WorkWorkspaceTab = "days" | "services";

export type Service = {
  id: string;
  barberId: string;
  name: string;
  price: string;
  durationMinutes: number;
  order?: number;
};

export type Appointment = {
  id: string;
  barberId: string;
  dateKey: string;
  startTime: string;
  durationMinutes: number;
  version?: number;
  lastOperationId?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type DayCell = {
  date: Date;
  day: number;
  monthOffset: -1 | 0 | 1;
  availability: Availability;
  freeSlots: number;
  totalSlots: number;
};

export type FormState = {
  fullName: string;
  phone: string;
};

export type ServiceDraft = {
  name: string;
  price: string;
  durationMinutes: string;
};

export type AdminEditDraft = {
  dateKey: string;
  startTime: string;
  price: string;
};

export type AppointmentStatus = "confirmed" | "rescheduled" | "cancelled" | "completed" | "no_show";

export type AppointmentColor = "blue" | "mint" | "pink" | "violet" | "amber" | "coral" | "sky" | "lime";

export type BookingSummary = {
  barberId: string;
  barberName: string;
  barberPhotoUrl: string;
  serviceName: string;
  servicePrice: string;
  durationMinutes: number;
  date: Date;
  time: string;
  fullName: string;
  phone: string;
};

export type AdminAppointment = Appointment & {
  clientId?: string;
  serviceId?: string;
  clientName: string;
  clientEmail?: string;
  clientPhotoUrl?: string;
  phone?: string;
  userId?: string;
  serviceName: string;
  price: string;
  priceAmount?: number;
  originalPriceAmount?: number;
  priceAdjustedAt?: number;
  priceAdjustedBy?: "admin";
  color: AppointmentColor;
  status?: AppointmentStatus;
  rescheduledAt?: number;
  rescheduledBy?: "client" | "admin";
  confirmedAt?: number;
  confirmedBy?: "client" | "admin";
  noShowAt?: number;
  noShowBy?: "admin";
  settlement?: {
    barberId: string;
    settledAt: number;
    amount: number;
  };
};

export type AvailabilityWindow = {
  id: string;
  barberId: string;
  dateKey: string;
  startTime: string;
  endTime: string;
};

export type WorkSettings = {
  availability: Record<string, AvailabilityWindow>;
};

export type AuthUser = Pick<User, "uid" | "displayName" | "email" | "photoURL">;

export type SessionContext = {
  role: "owner" | "barber" | "client";
  assignedRole?: "barber";
  active: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  barberId: string;
  access: Record<BarberAdminSection, boolean>;
  roleError?: "conflicting_barber_assignment";
};

export type SmsTemplate = "confirmation" | "reschedule" | "reminder" | "custom";

export type ClientFilter = "all" | "upcoming" | "rescheduled" | "missing-phone";

export type ClientWorkspaceTab = "appointments" | "directory";

export type AnalyticsPeriod = "week" | "month" | "quarter" | "year";

export type AdminClientProfile = {
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

export type ClientRecord = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  photoUrl: string;
  userId?: string;
  barberIds?: Record<string, boolean>;
  hiddenFor?: Record<string, boolean>;
  createdAt?: number;
  updatedAt?: number;
};

export type ClientDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

export type ManualBookingDraft = {
  serviceId: string;
  dateKey: string;
  startTime: string;
};

export type ClientDialogState =
  | { mode: "create"; waitlistEntryId?: string }
  | { mode: "book"; clientId: string; waitlistEntryId?: string };

export type SmsComposerState = {
  clientId: string;
  appointmentId: string;
  template: SmsTemplate;
  message: string;
};

export type WorkFeedback = {
  kind: "success" | "error";
  message: string;
};

export type ActionFeedback = {
  key: string;
  kind: "pending" | "success" | "error";
  message: string;
};

export type ClientSaveMode = "record" | "booking";

export type WaitlistTimePreference = "any" | "morning" | "afternoon" | "evening";

export type WaitlistOffer = {
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

export type WaitlistEntry = {
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

export type WaitlistDraft = {
  dateFrom: string;
  dateTo: string;
  timePreference: WaitlistTimePreference;
  clientName: string;
  phone: string;
};

export type PendingWaitlistSelection = {
  waitlistId: string;
  barberId: string;
  serviceId: string;
  dateKey: string;
  startTime: string;
};

export type PendingAdminWaitlistSelection = {
  waitlistId: string;
  barberId: string;
};

export type BarberProfile = {
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

export type TeamMemberDraft = {
  name: string;
  email: string;
};

export type BarberDetails = {
  displayName: string;
  phone: string;
  email: string;
  instagram: string;
  bio: string;
  photoUrl: string;
  updatedAt?: number;
};

export type InstallPlatform = "ios" | "android";

export type InstallGuideIcon =
  | "safari"
  | "share"
  | "add"
  | "done"
  | "chrome"
  | "menu"
  | "download";
