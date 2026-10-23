import {
  getAccessToken,
  jsonResponse,
  patchDatabase,
  readDatabase,
  readDatabaseQuery,
} from "./_firebase-admin.mjs";
import { sendDirectPush } from "./_notification-service.mjs";
import {
  MAX_REMINDERS_PER_RUN,
  findDueReminders,
  findExpiredReminderIds,
  formatReminder,
  reminderRecord,
} from "../../shared/reminders.mjs";

// Every few minutes: clients whose visit is about a day away get one push with "Potwierdzam" and "Odwołuję".
// The buttons open the app on that visit; a cancellation there frees the slot for the waiting list as usual.
export const sendAppointmentReminders = async ({ accessToken, now = Date.now(), siteUrl }) => {
  const members = (await readDatabase("team/barbers", accessToken)) ?? {};
  const activeBarbers = Object.entries(members).filter(([, member]) => member?.active === true);
  const perBarber = await Promise.all(activeBarbers.map(([barberId]) =>
    readDatabaseQuery("appointments", { orderBy: "barberId", equalTo: barberId }, accessToken)));
  const appointments = Object.assign({}, ...perBarber.map((records) => records ?? {}));

  const sent = (await readDatabase("appointmentReminders", accessToken)) ?? {};
  const due = findDueReminders(appointments, sent, { now }).slice(0, MAX_REMINDERS_PER_RUN);

  let delivered = 0;
  for (const { id, appointment } of due) {
    const copy = formatReminder(appointment, {
      barberName: members[appointment.barberId]?.name,
      now: new Date(now),
    });
    const result = await sendDirectPush({
      accessToken,
      uid: appointment.userId,
      title: copy.title,
      body: copy.body,
      tag: id,
      siteUrl,
      event: "reminder",
      query: { appointment: id },
      data: { actions: "attend" },
    });
    // A client without a push device is remembered too, so the next run does not retry them forever.
    if (result.sent > 0 || result.targets === 0) {
      await patchDatabase(
        `appointmentReminders/${encodeURIComponent(id)}`,
        reminderRecord(appointment, now, result.sent > 0),
        accessToken,
      );
    }
    if (result.sent > 0) delivered += 1;
  }

  const expired = findExpiredReminderIds(sent, now);
  if (expired.length > 0) {
    await patchDatabase("appointmentReminders", Object.fromEntries(expired.map((id) => [id, null])), accessToken);
  }
  return { ok: true, due: due.length, delivered, expired: expired.length };
};

const handler = async () => {
  try {
    return jsonResponse(await sendAppointmentReminders({
      accessToken: await getAccessToken(),
      siteUrl: process.env.URL || process.env.DEPLOY_PRIME_URL || "https://bnbbarbershop.pl",
    }));
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : "Appointment reminders failed." },
      500,
    );
  }
};

export const config = {
  schedule: "*/15 * * * *",
};

export default handler;
