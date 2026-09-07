"use client";
import { useMemo } from "react";
import { getAppointmentEndDateTime, normalizeAppointmentStatus, isClosedAppointmentStatus, getAdminClientId, getPhoneDigits, getClientFullName, getAppointmentSortValue, canSettleAppointment } from "../lib/booking-selectors";
import type { AdminAppointment, ClientFilter, ClientWorkspaceTab, AdminClientProfile, ClientRecord } from "../lib/booking-types";

export function useClientDirectory({ activeBarberId, adminClientAppointments, clientRecords, currentDate, clientWorkspaceTab, clientSearch, clientFilter, calendarClientSearch }: {
  activeBarberId: string; adminClientAppointments: AdminAppointment[]; clientRecords: ClientRecord[]; currentDate: Date;
  clientWorkspaceTab: ClientWorkspaceTab; clientSearch: string; clientFilter: ClientFilter; calendarClientSearch: string;
}) {
  const adminClientProfiles = useMemo<AdminClientProfile[]>(() => {
    const appointmentGroups = new Map<string, AdminAppointment[]>();

    adminClientAppointments.forEach((appointment) => {
      const clientId = getAdminClientId(appointment);
      appointmentGroups.set(clientId, [...(appointmentGroups.get(clientId) ?? []), appointment]);
    });

    const recordsById = new Map(
      clientRecords
        .filter(
          (client) =>
            client.barberIds?.[activeBarberId] ||
            appointmentGroups.has(client.id),
        )
        .map((client) => [client.id, client]),
    );
    const clientIds = new Set([...recordsById.keys(), ...appointmentGroups.keys()]);

    return Array.from(clientIds)
      .map((id) => {
        const clientRecord = recordsById.get(id);
        const clientAppointments = appointmentGroups.get(id) ?? [];
        const sortedAppointments = [...clientAppointments].sort((first, second) =>
          getAppointmentSortValue(first).localeCompare(getAppointmentSortValue(second)),
        );
        const newestContact = [...sortedAppointments]
          .reverse()
          .find((appointment) => appointment.phone || appointment.clientEmail) ?? sortedAppointments[0];
        const nextAppointment =
          sortedAppointments.find(
            (appointment) =>
              !isClosedAppointmentStatus(appointment.status) &&
              getAppointmentEndDateTime(appointment).getTime() > currentDate.getTime(),
          ) ?? null;
        const lastAppointment =
          [...sortedAppointments]
            .reverse()
            .find(
              (appointment) =>
                normalizeAppointmentStatus(appointment.status) === "completed" ||
                getAppointmentEndDateTime(appointment).getTime() <= currentDate.getTime(),
            ) ?? null;

        return {
          id,
          userId: clientRecord?.userId,
          name: clientRecord ? getClientFullName(clientRecord) : newestContact?.clientName ?? "Klient",
          email: clientRecord?.email || newestContact?.clientEmail || "",
          phone: clientRecord?.phone || newestContact?.phone || "",
          photoUrl: clientRecord?.photoUrl || newestContact?.clientPhotoUrl || "",
          appointments: sortedAppointments,
          nextAppointment,
          lastAppointment,
          rescheduledCount: sortedAppointments.filter(
            (appointment) => normalizeAppointmentStatus(appointment.status) === "rescheduled",
          ).length,
          hiddenFromDirectory: Boolean(clientRecord?.hiddenFor?.[activeBarberId]),
        };
      })
      .sort((first, second) => {
        if (first.nextAppointment && second.nextAppointment) {
          return getAppointmentSortValue(first.nextAppointment).localeCompare(
            getAppointmentSortValue(second.nextAppointment),
          );
        }
        if (first.nextAppointment) return -1;
        if (second.nextAppointment) return 1;
        return first.name.localeCompare(second.name, "pl");
      });
  }, [activeBarberId, adminClientAppointments, clientRecords, currentDate]);
  const activeAdminClientProfiles = useMemo(
    () =>
      adminClientProfiles.filter(
        (client) =>
          Boolean(client.nextAppointment) ||
          client.appointments.some((appointment) => canSettleAppointment(appointment, currentDate)),
      ),
    [adminClientProfiles, currentDate],
  );
  const directoryAdminClientProfiles = useMemo(
    () => adminClientProfiles.filter((client) => !client.hiddenFromDirectory),
    [adminClientProfiles],
  );
  const clientWorkspaceProfiles =
    clientWorkspaceTab === "appointments"
      ? activeAdminClientProfiles
      : directoryAdminClientProfiles;
  const filteredAdminClients = useMemo(() => {
    const query = clientSearch.trim().toLocaleLowerCase("pl");

    return clientWorkspaceProfiles.filter((client) => {
      const phoneDigits = getPhoneDigits(client.phone);
      const matchesQuery =
        !query ||
        [client.name, client.email, client.phone, phoneDigits]
          .join(" ")
          .toLocaleLowerCase("pl")
          .includes(query) ||
        client.appointments.some((appointment) =>
          appointment.serviceName.toLocaleLowerCase("pl").includes(query),
        );

      if (!matchesQuery) return false;
      if (clientFilter === "upcoming") return Boolean(client.nextAppointment);
      if (clientFilter === "rescheduled") return client.rescheduledCount > 0;
      if (clientFilter === "missing-phone") return phoneDigits.length !== 9;
      return true;
    });
  }, [clientFilter, clientSearch, clientWorkspaceProfiles]);
  const calendarBookingClients = useMemo(() => {
    const query = calendarClientSearch.trim().toLocaleLowerCase("pl");

    return directoryAdminClientProfiles.filter((client) =>
      !query
        ? true
        : [client.name, client.email, client.phone, getPhoneDigits(client.phone)]
            .join(" ")
            .toLocaleLowerCase("pl")
            .includes(query),
    );
  }, [calendarClientSearch, directoryAdminClientProfiles]);
  return { adminClientProfiles, activeAdminClientProfiles, directoryAdminClientProfiles, clientWorkspaceProfiles, filteredAdminClients, calendarBookingClients };
}
