import { type Service, type BarberDetails, type BarberAdminSection, type BarberProfile } from "./booking-types";
import { barberAdminSections } from "./booking-labels";

export const servicesToRecord = (items: Service[], barberId: string) =>
  Object.fromEntries(
    items.map((service, index) => [
      service.id,
      { ...service, barberId, order: index },
    ]),
  );

export const normalizeBarberDetails = (value: Partial<BarberDetails> | null): BarberDetails => ({
  specialties: value?.specialties?.trim() ?? "",
  displayName: value?.displayName?.trim() ?? "",
  phone: value?.phone?.trim() ?? "",
  email: value?.email?.trim() ?? "",
  instagram: value?.instagram?.trim() ?? "",
  bio: value?.bio?.trim() ?? "",
  photoUrl: value?.photoUrl?.trim() ?? "",
  updatedAt: Number(value?.updatedAt) || undefined,
});

export const normalizeBarberAccess = (
  value: Partial<Record<BarberAdminSection, boolean>> | null | undefined,
): Record<BarberAdminSection, boolean> =>
  Object.fromEntries(
    barberAdminSections.map((section) => [section, value?.[section] === true]),
  ) as Record<BarberAdminSection, boolean>;

export const normalizeTeamMember = (
  id: string,
  value: Partial<BarberProfile> | null,
  index: number,
): BarberProfile => ({
  id,
  name: value?.name?.trim() || `Barber ${index + 1}`,
  label: value?.label?.trim() || `Barber ${index + 1}`,
  accent: value?.accent === "mint" ? "mint" : index % 2 === 0 ? "blue" : "mint",
  userId: value?.userId?.trim() ?? "",
  email: value?.email?.trim().toLocaleLowerCase("pl") ?? "",
  active: value?.active === true,
  access: normalizeBarberAccess(value?.access),
  createdAt: Number(value?.createdAt) || undefined,
  updatedAt: Number(value?.updatedAt) || undefined,
});
