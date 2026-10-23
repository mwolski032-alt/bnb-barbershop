import { type AdminSection, type AdminWorkspaceTab, type WorkWorkspaceTab, type ClientWorkspaceTab, type AnalyticsPeriod, type ClientFilter, type FormState } from "./booking-types";

export const viewMemoryVersion = 1;

export type OwnerPanelTab = "photos" | "barbers" | "errors";

export type ViewMemory = {
  version: typeof viewMemoryVersion;
  surface: "salon" | "admin";
  wizardOpen: boolean;
  wizardStep: number;
  adminSection: AdminSection;
  adminWorkspaceTab: AdminWorkspaceTab;
  ownerPanelTab: OwnerPanelTab;
  workWorkspaceTab: WorkWorkspaceTab;
  clientWorkspaceTab: ClientWorkspaceTab;
  analyticsPeriod: AnalyticsPeriod;
  clientFilter: ClientFilter;
  selectedBarberId: string | null;
  selectedServiceId: string;
  visibleMonth: string;
  selectedKey: string;
  selectedTime: string;
  form: FormState;
  adminSelectedKey: string;
  clientSearch: string;
  calendarClientSearch: string;
  expandedAvailabilityMonth: string | null;
  scrollPositions: Record<string, number>;
};

export const viewMemoryKey = (userId: string) => `bnb-view-memory-v${viewMemoryVersion}:${userId}`;

export const isDateKeyValue = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const isMonthKeyValue = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}$/.test(value);

export const isOneOf = <Value extends string>(value: unknown, allowed: readonly Value[]): value is Value =>
  typeof value === "string" && allowed.includes(value as Value);

export const readViewMemory = (userId: string): Partial<ViewMemory> | null => {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(viewMemoryKey(userId)) ?? "null") as
      | Partial<ViewMemory>
      | null;
    return parsed?.version === viewMemoryVersion ? parsed : null;
  } catch {
    return null;
  }
};

export const writeViewMemory = (userId: string, memory: ViewMemory) => {
  try {
    window.sessionStorage.setItem(viewMemoryKey(userId), JSON.stringify(memory));
  } catch {
    // The application still keeps its in-memory state when browser storage is unavailable.
  }
};

export const clearViewMemory = (userId: string) => {
  try {
    window.sessionStorage.removeItem(viewMemoryKey(userId));
  } catch {}
};
