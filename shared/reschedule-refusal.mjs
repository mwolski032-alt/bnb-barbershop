// A client moves a visit; the barber either confirms the new term or refuses it. Refusing does not cancel
// the visit: it goes back to the term it had, and the client is asked to pick another one.
// Pure functions, covered by unit tests, shared by the schedule API and the notification buttons.

import { isBookableStartTime } from "./booking-time.mjs";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const toMinutes = (time) => {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
};

/** Called when a client moves a visit: remembers the term it had, unless a term is already remembered. */
export const withPreviousSchedule = (current, next) => {
  const alreadyMoved = current.status === "rescheduled" && datePattern.test(current.previousDateKey ?? "");
  return {
    ...next,
    previousDateKey: alreadyMoved ? current.previousDateKey : current.dateKey,
    previousStartTime: alreadyMoved ? current.previousStartTime : current.startTime,
  };
};

/** The remembered term belongs to a move that has been answered or replaced. */
export const withoutPreviousSchedule = (appointment) => {
  const rest = { ...appointment };
  delete rest.previousDateKey;
  delete rest.previousStartTime;
  return rest;
};

/** A new move replaces the note about an earlier refused one. */
export const withoutRefusalNote = (appointment) => {
  const rest = { ...appointment };
  delete rest.rescheduleRefusedAt;
  delete rest.rescheduleRefusedFrom;
  return rest;
};

/** A move made by the client that the barber has not answered, with a term to go back to. */
export const canRefuseClientReschedule = (appointment) =>
  appointment?.status === "rescheduled" &&
  appointment.rescheduledBy === "client" &&
  datePattern.test(appointment.previousDateKey ?? "") &&
  timePattern.test(appointment.previousStartTime ?? "");

const overlaps = (appointments, candidate, excludedId) =>
  Object.entries(appointments ?? {}).some(([id, other]) => {
    if (!other || (other.id || id) === excludedId || id === excludedId) return false;
    if (other.status === "cancelled") return false;
    if (other.barberId !== candidate.barberId || other.dateKey !== candidate.dateKey) return false;
    const otherStart = toMinutes(other.startTime);
    const start = toMinutes(candidate.startTime);
    return otherStart < start + candidate.durationMinutes && start < otherStart + Number(other.durationMinutes);
  });

/**
 * The visit as it is after the barber refuses the move: back at the remembered term, confirmed, with a note
 * of the refused term. Returns { error } when going back is not possible (the old term is taken or has passed).
 */
export const refuseClientReschedule = (appointments, appointment, { now = Date.now(), isHeld = () => false } = {}) => {
  if (!canRefuseClientReschedule(appointment)) {
    return { error: "Tej zmiany terminu nie da się odrzucić, bo wizyta nie ma zapisanego poprzedniego terminu. Potwierdź ją albo odwołaj." };
  }
  const restored = { ...appointment, dateKey: appointment.previousDateKey, startTime: appointment.previousStartTime };
  if (!isBookableStartTime(restored.dateKey, restored.startTime, new Date(now))) {
    return { error: "Poprzedni termin już minął. Potwierdź nowy termin albo odwołaj wizytę." };
  }
  if (overlaps(appointments, restored, appointment.id) || isHeld(restored)) {
    return { error: "Poprzedni termin został w międzyczasie zajęty. Potwierdź nowy termin albo odwołaj wizytę." };
  }
  return {
    appointment: {
      ...withoutPreviousSchedule(restored),
      status: "confirmed",
      rescheduleRefusedAt: now,
      rescheduleRefusedFrom: { dateKey: appointment.dateKey, startTime: appointment.startTime },
    },
  };
};
