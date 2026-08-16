import {
  getAccessToken,
  getAdminContext,
  jsonResponse,
  patchDatabase,
  readAppointmentsWithEtag,
  readDatabase,
  readTeamMember,
  verifyRequestUser,
  writeAppointmentsIfUnchanged,
} from "./_firebase-admin.mjs";

const allowedActions = new Set([
  "create_client",
  "reschedule_client",
  "confirm_client",
  "confirm_admin",
  "cancel_client",
  "create_admin",
  "reschedule_admin",
  "cancel_admin",
  "settle_admin",
]);

const appointmentStatuses = new Set(["confirmed", "rescheduled", "cancelled", "completed"]);
const appointmentColors = new Set(["blue", "mint", "pink", "violet", "amber", "coral", "sky", "lime"]);
const fallbackServices = [
  { id: "mens-haircut", name: "Strzyżenie męskie", price: "30 zł", durationMinutes: 90 },
  { id: "beard-trim", name: "Trymowanie brody", price: "20 zł", durationMinutes: 60 },
];
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const cleanText = (value, maxLength = 160) => String(value ?? "").trim().slice(0, maxLength);
const timeToMinutes = (time) => {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
};
const rangesOverlap = (firstStart, firstDuration, secondStart, secondDuration) =>
  firstStart < secondStart + secondDuration && secondStart < firstStart + firstDuration;

const normalizeAppointment = (id, value = {}) => ({
  ...value,
  id: cleanText(value.id || id, 120),
  barberId: cleanText(value.barberId || "mateusz", 80),
  clientId: cleanText(value.clientId, 120),
  serviceId: cleanText(value.serviceId, 120),
  userId: cleanText(value.userId, 128),
  dateKey: cleanText(value.dateKey, 10),
  startTime: cleanText(value.startTime, 5),
  durationMinutes: Math.max(15, Math.min(480, Number(value.durationMinutes) || 30)),
  clientName: cleanText(value.clientName || "Klient", 120),
  clientEmail: cleanText(value.clientEmail, 254).toLowerCase(),
  clientPhotoUrl: cleanText(value.clientPhotoUrl, 500000),
  phone: cleanText(value.phone, 32),
  serviceName: cleanText(value.serviceName || "Usługa", 120),
  price: cleanText(value.price || "0 zł", 40),
  color: appointmentColors.has(value.color) ? value.color : "blue",
  status: appointmentStatuses.has(value.status) ? value.status : "confirmed",
});

const validateAppointmentTime = (appointment) => {
  if (!appointment.id || !appointment.barberId) return "Brak identyfikatora wizyty lub barbera.";
  if (!datePattern.test(appointment.dateKey) || !timePattern.test(appointment.startTime)) {
    return "Nieprawidłowa data lub godzina wizyty.";
  }
  if (!Number.isInteger(appointment.durationMinutes) || appointment.durationMinutes < 15) {
    return "Nieprawidłowy czas trwania wizyty.";
  }
  return "";
};

const hasConflict = (appointments, candidate, excludedId = "") =>
  Object.entries(appointments).some(([id, raw]) => {
    if (id === excludedId) return false;
    const appointment = normalizeAppointment(id, raw);
    if (appointment.status === "cancelled") return false;
    return (
      appointment.barberId === candidate.barberId &&
      appointment.dateKey === candidate.dateKey &&
      rangesOverlap(
        timeToMinutes(appointment.startTime),
        appointment.durationMinutes,
        timeToMinutes(candidate.startTime),
        candidate.durationMinutes,
      )
    );
  });

const canAdminManageAppointment = (admin, appointment) =>
  admin.isOwner || (admin.isAdmin && admin.barberId === appointment.barberId);

const readClientBookingConfiguration = async (appointment, accessToken) => {
  const member = await readTeamMember(appointment.barberId, accessToken);
  if (!member || member.active === false) throw new Error("Wybrany barber jest nieaktywny.");

  const barberServices = await readDatabase(`barbers/${appointment.barberId}/services`, accessToken);
  const legacyServices = appointment.barberId === "mateusz"
    ? await readDatabase("services", accessToken)
    : null;
  const services = Object.values(barberServices ?? legacyServices ?? fallbackServices);
  const service = services.find(
    (item) =>
      cleanText(item?.id, 120) === appointment.serviceId ||
      cleanText(item?.name, 120) === appointment.serviceName,
  );
  if (!service) throw new Error("Wybrana usługa nie jest już dostępna.");
  appointment.serviceId = cleanText(service.id, 120);
  appointment.serviceName = cleanText(service.name, 120);
  appointment.price = cleanText(service.price, 40);
  appointment.durationMinutes = Math.max(15, Math.min(480, Number(service.durationMinutes) || 30));

  const barberSettings = await readDatabase(`barbers/${appointment.barberId}/workSettings`, accessToken);
  const legacySettings = appointment.barberId === "mateusz"
    ? await readDatabase("workSettings", accessToken)
    : null;
  const settings = barberSettings ?? legacySettings ?? {};
  const availability = settings.availability?.[appointment.dateKey];
  if (!availability) throw new Error("Wybrany dzień nie jest dostępny.");

  const start = timeToMinutes(appointment.startTime);
  const availabilityStart = timeToMinutes(availability.startTime);
  const availabilityEnd = timeToMinutes(availability.endTime);
  if (start < availabilityStart || start + appointment.durationMinutes > availabilityEnd) {
    throw new Error("Wybrana godzina jest poza dostępnością barbera.");
  }

  const todayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date());
  if (appointment.dateKey < todayKey) throw new Error("Nie można zarezerwować minionego terminu.");
};

const mutateAppointments = async (accessToken, mutation) => {
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const { appointments, etag } = await readAppointmentsWithEtag(accessToken);
    const result = await mutation({ ...appointments });
    if (result.error) return result;
    if (await writeAppointmentsIfUnchanged(result.appointments, etag, accessToken)) return result;
    await new Promise((resolve) => setTimeout(resolve, 20 + attempt * 25));
  }
  return { error: "Terminarz zmienił się w tym samym momencie. Spróbuj ponownie." };
};

const getClientData = async (user, accessToken) => {
  const rawAppointments = (await readDatabase("appointments", accessToken)) ?? {};
  const occupancy = [];
  const clientAppointments = [];
  const todayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date());

  for (const [id, raw] of Object.entries(rawAppointments)) {
    const appointment = normalizeAppointment(id, raw);
    if (
      appointment.status !== "cancelled" &&
      appointment.status !== "completed" &&
      appointment.dateKey >= todayKey
    ) {
      occupancy.push({
        id: appointment.id,
        barberId: appointment.barberId,
        dateKey: appointment.dateKey,
        startTime: appointment.startTime,
        durationMinutes: appointment.durationMinutes,
      });
    }
    if (appointment.userId === user.uid) clientAppointments.push(appointment);
  }

  return { occupancy, clientAppointments };
};

const handler = async (request) => {
  try {
    const user = await verifyRequestUser(request);
    if (!user) return jsonResponse({ ok: false, error: "Brak ważnej sesji." }, 401);
    const accessToken = await getAccessToken();

    if (request.method === "GET") {
      return jsonResponse({ ok: true, ...(await getClientData(user, accessToken)) });
    }
    if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);

    const body = await request.json();
    const action = cleanText(body.action, 40);
    if (!allowedActions.has(action)) return jsonResponse({ ok: false, error: "Nieznana operacja." }, 400);

    const admin = await getAdminContext(user, accessToken);
    const proposed = body.appointment
      ? normalizeAppointment(body.appointment.id, body.appointment)
      : null;
    const appointmentId = cleanText(body.appointmentId || proposed?.id, 120);

    if (action === "create_client") {
      if (!proposed || proposed.userId && proposed.userId !== user.uid) {
        return jsonResponse({ ok: false, error: "Nieprawidłowy właściciel wizyty." }, 403);
      }
      proposed.userId = user.uid;
      proposed.clientId = user.uid;
      proposed.clientEmail = user.email;
      proposed.clientPhotoUrl = user.photoUrl;
      proposed.status = "confirmed";
      if (proposed.clientName.length < 3 || proposed.phone.replace(/\D/g, "").length !== 9) {
        return jsonResponse({ ok: false, error: "Nieprawidłowe dane klienta." }, 400);
      }
      const validationError = validateAppointmentTime(proposed);
      if (validationError) return jsonResponse({ ok: false, error: validationError }, 400);
      await readClientBookingConfiguration(proposed, accessToken);
    }

    if (action === "create_admin") {
      if (!admin.isAdmin || !proposed || !canAdminManageAppointment(admin, proposed)) {
        return jsonResponse({ ok: false, error: "Brak uprawnień do tego terminarza." }, 403);
      }
      const validationError = validateAppointmentTime(proposed);
      if (validationError) return jsonResponse({ ok: false, error: validationError }, 400);
    }

    const result = await mutateAppointments(accessToken, async (appointments) => {
      if (action === "create_client" || action === "create_admin") {
        if (appointments[proposed.id]) return { error: "Ta wizyta już istnieje." };
        if (hasConflict(appointments, proposed)) return { error: "Ten termin został właśnie zajęty." };
        appointments[proposed.id] = proposed;
        return { appointments, appointment: proposed };
      }

      const currentRaw = appointments[appointmentId];
      if (!currentRaw) return { error: "Wizyta nie istnieje.", status: 404 };
      const current = normalizeAppointment(appointmentId, currentRaw);
      const isClientAction = action.endsWith("_client");
      if (isClientAction && current.userId !== user.uid) {
        return { error: "Brak dostępu do wizyty.", status: 403 };
      }
      if (!isClientAction && (!admin.isAdmin || !canAdminManageAppointment(admin, current))) {
        return { error: "Brak uprawnień do tego terminarza.", status: 403 };
      }
      if (
        (action === "confirm_client" || action === "confirm_admin") &&
        (current.status !== "rescheduled" ||
          (action === "confirm_client" && current.rescheduledBy === "client") ||
          (action === "confirm_admin" && current.rescheduledBy === "admin"))
      ) {
        return { error: "Ta zmiana terminu została już potwierdzona.", status: 409 };
      }

      let next = { ...current };
      if (action === "reschedule_client" || action === "reschedule_admin") {
        next.dateKey = cleanText(body.dateKey, 10);
        next.startTime = cleanText(body.startTime, 5);
        next.status = "rescheduled";
        next.rescheduledAt = Date.now();
        next.rescheduledBy = action === "reschedule_client" ? "client" : "admin";
        const validationError = validateAppointmentTime(next);
        if (validationError) return { error: validationError };
        if (action === "reschedule_client") await readClientBookingConfiguration(next, accessToken);
        if (hasConflict(appointments, next, appointmentId)) {
          return { error: "Ten termin został właśnie zajęty." };
        }
      } else if (action === "confirm_client" || action === "confirm_admin") {
        next.status = "confirmed";
        next.confirmedAt = Date.now();
        next.confirmedBy = action === "confirm_client" ? "client" : "admin";
      } else if (action === "cancel_client" || action === "cancel_admin") {
        next.status = "cancelled";
        next.cancelledAt = Date.now();
        next.cancelledBy = action === "cancel_client" ? "client" : "admin";
      } else if (action === "settle_admin") {
        const amount = Math.max(0, Number(body.amount) || 0);
        const settledAt = Date.now();
        next.status = "completed";
        next.settledAt = settledAt;
        next.settledAmount = amount;
        next.settlement = { barberId: next.barberId, settledAt, amount };
      }

      appointments[appointmentId] = next;
      return { appointments, appointment: next };
    });

    if (result.error) return jsonResponse({ ok: false, error: result.error }, result.status ?? 409);

    if (action === "create_client" && body.client) {
      const client = body.client;
      await patchDatabase(
        `clients/${user.uid}`,
        {
          id: user.uid,
          firstName: cleanText(client.firstName, 80),
          lastName: cleanText(client.lastName, 80),
          email: user.email,
          phone: cleanText(client.phone, 32),
          photoUrl: user.photoUrl,
          userId: user.uid,
          [`barberIds/${proposed.barberId}`]: true,
          [`hiddenFor/${proposed.barberId}`]: null,
          updatedAt: Date.now(),
        },
        accessToken,
      );
    }

    return jsonResponse({ ok: true, appointment: result.appointment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nieznany błąd serwera.";
    const status = /nieaktywny|dostępny|godzina|minionego/i.test(message) ? 409 : 500;
    return jsonResponse({ ok: false, error: message }, status);
  }
};

export default handler;
