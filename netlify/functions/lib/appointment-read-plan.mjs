import { readDatabase, readDatabaseQuery } from "../_firebase-admin.mjs";
import { isFirebaseKeySafe } from "../../../shared/data-model.mjs";

const isolatedActions = new Set(["reschedule_client", "reschedule_admin", "confirm_client", "confirm_admin", "update_admin", "settle_admin"]);
const scopedActions = new Set([...isolatedActions, "create_client", "create_admin", "cancel_client", "cancel_admin", "mark_no_show_admin", "join_waitlist", "leave_waitlist", "remove_waitlist_admin"]);
const merge = (...records) => Object.assign({}, ...records.filter(Boolean));
const safe = value => typeof value === "string" && isFirebaseKeySafe(value) ? value : "";

export async function createAppointmentReadPlan(accessToken, operation, action, user) {
  const body = operation.input ?? {};
  const appointmentId = safe(body.appointmentId || body.appointment?.id);
  const current = appointmentId ? await readDatabase(`appointments/${appointmentId}`, accessToken) : null;
  const barberId = safe(current?.barberId);
  const isolated = isolatedActions.has(action) && barberId;
  return {
    lockScope: isolated ? `barber_${barberId}` : "appointments",
    load: async () => {
      const queries = new Map();
      const read = (path, query) => {
        const key = JSON.stringify([path, query]);
        if (!queries.has(key)) queries.set(key, query ? readDatabaseQuery(path, query, accessToken) : readDatabase(path, accessToken));
        return queries.get(key);
      };
      const by = (section, field, value) => value ? read(section, { orderBy: field, equalTo: value }) : Promise.resolve({});
      const [team, existingOperation] = await Promise.all([
        read("team"), read(`appointmentOperations/${operation.operationId}`),
      ]);
      const base = { team, appointmentOperations: existingOperation ? { [operation.operationId]: existingOperation } : {}, notificationOutbox: {} };
      if (existingOperation) return { ...base, appointments: {}, clients: {}, waitlistEntries: {} };
      if (!scopedActions.has(action)) {
        const [appointments, clients, waitlistEntries, operations, outbox] = await Promise.all([
          read("appointments"), read("clients"), read("waitlistEntries"),
          action === "delete_admin_client" ? read("appointmentOperations") : {},
          action === "delete_admin_client" ? read("notificationOutbox") : {},
        ]);
        return { ...base, appointments: appointments ?? {}, clients: clients ?? {}, waitlistEntries: waitlistEntries ?? {},
          appointmentOperations: merge(operations, base.appointmentOperations), notificationOutbox: outbox ?? {} };
      }
      const record = appointmentId ? await read(`appointments/${appointmentId}`) : null;
      const waitlistId = safe(body.waitlistId || body.waitlistEntry?.id);
      const entry = waitlistId ? await read(`waitlistEntries/${waitlistId}`) : null;
      const targetBarber = safe(record?.barberId || body.appointment?.barberId || entry?.barberId || body.waitlistEntry?.barberId);
      if (isolated && targetBarber !== barberId) throw new Error("Wizyta zmieniła terminarz. Odśwież widok.");
      const clientId = safe(record?.clientId || body.appointment?.clientId || user.uid);
      const uid = safe(record?.userId || (action === "create_client" ? user.uid : ""));
      const [barberAppointments, clientAppointments, userAppointments, client, aliases, waitlist] = await Promise.all([
        by("appointments", "barberId", targetBarber),
        !isolated ? by("appointments", "clientId", clientId) : {},
        !isolated ? by("appointments", "userId", uid) : {},
        !isolated && clientId ? read(`clients/${clientId}`) : null,
        action === "create_client" ? by("clients", "userId", user.uid) : {},
        !isolated ? by("waitlistEntries", "barberId", targetBarber) : {},
      ]);
      // Preserve all explicitly UID-linked legacy history when canonicalizing a client.
      const aliasHistory = await Promise.all(Object.keys(aliases ?? {}).map(id => by("appointments", "clientId", id)));
      return { ...base, appointments: merge(barberAppointments, clientAppointments, userAppointments, ...aliasHistory,
        record ? { [appointmentId]: record } : {}),
        clients: merge(aliases, client ? { [clientId]: client } : {}),
        waitlistEntries: merge(waitlist, entry ? { [waitlistId]: entry } : {}),
      };
    },
  };
}
