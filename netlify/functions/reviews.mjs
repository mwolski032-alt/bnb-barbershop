import {
  claimRateLimit,
  getAccessToken,
  jsonResponse,
  readDatabase,
  verifyRequestUser,
  writeDatabaseIfUnchanged,
} from "./_firebase-admin.mjs";
import { cleanText, isFirebaseKeySafe, normalizeAppointmentRecord } from "../../shared/data-model.mjs";
import {
  buildPublicReviews,
  normalizeReviewInput,
  publicAuthorName,
  toPublicReview,
} from "../../shared/reviews.mjs";

// GET                     -> public list and averages of every review (no sign-in).
// GET ?appointmentId=ID   -> the signed-in client's own review of that visit, if any.
// GET ?mine=1             -> the ids of the barbers the signed-in client has already reviewed.
// POST {appointmentId, rating, text} -> the signed-in client reviews one of their settled visits;
//                            each client may review each barber once.
const handler = async (request) => {
  try {
    const accessToken = await getAccessToken();

    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      const appointmentId = cleanText(params.get("appointmentId"), 120);
      if (params.get("mine") === "1") {
        const user = await verifyRequestUser(request);
        if (!user) return jsonResponse({ ok: false, error: "Zaloguj się, aby zobaczyć swoje opinie." }, 401);
        const stored = (await readDatabase("reviews", accessToken)) ?? {};
        const reviewedBarberIds = [
          ...new Set(
            Object.values(stored)
              .filter((review) => review && review.userId === user.uid && review.barberId)
              .map((review) => String(review.barberId)),
          ),
        ];
        return jsonResponse({ ok: true, reviewedBarberIds });
      }
      if (!appointmentId) {
        return jsonResponse({ ok: true, ...buildPublicReviews(await readDatabase("reviews", accessToken)) });
      }
      const user = await verifyRequestUser(request);
      if (!user) return jsonResponse({ ok: false, error: "Zaloguj się, aby zobaczyć swoją opinię." }, 401);
      if (!isFirebaseKeySafe(appointmentId)) return jsonResponse({ ok: false, error: "Nieprawidłowa wizyta." }, 400);
      const review = await readDatabase(`reviews/${encodeURIComponent(appointmentId)}`, accessToken);
      if (review && review.userId === user.uid) {
        return jsonResponse({ ok: true, review: toPublicReview(appointmentId, review) });
      }
      // One review per client and barber: an earlier visit's review stands in for this visit too.
      const raw = await readDatabase(`appointments/${encodeURIComponent(appointmentId)}`, accessToken);
      if (!raw || raw.userId !== user.uid || !raw.barberId) return jsonResponse({ ok: true, review: null });
      const stored = (await readDatabase("reviews", accessToken)) ?? {};
      const earlier = Object.entries(stored).find(
        ([, item]) => item && item.userId === user.uid && item.barberId === raw.barberId,
      );
      return jsonResponse({ ok: true, review: earlier ? toPublicReview(earlier[0], earlier[1]) : null });
    }

    if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

    const user = await verifyRequestUser(request);
    if (!user) return jsonResponse({ ok: false, error: "Zaloguj się, aby dodać opinię." }, 401);

    const body = await request.json().catch(() => ({}));
    const appointmentId = cleanText(body.appointmentId, 120);
    if (!isFirebaseKeySafe(appointmentId)) return jsonResponse({ ok: false, error: "Nieprawidłowa wizyta." }, 400);
    const input = normalizeReviewInput(body);
    if (input.error) return jsonResponse({ ok: false, error: input.error }, 400);

    if (!(await claimRateLimit(user.uid, "review", 3_000, accessToken))) {
      return jsonResponse({ ok: false, error: "Chwileczkę, spróbuj za moment." }, 429);
    }

    const raw = await readDatabase(`appointments/${encodeURIComponent(appointmentId)}`, accessToken);
    const appointment = raw ? normalizeAppointmentRecord(appointmentId, raw) : null;
    if (!appointment || appointment.userId !== user.uid) {
      return jsonResponse({ ok: false, error: "Nie znaleziono tej wizyty." }, 404);
    }
    if (appointment.status !== "completed") {
      return jsonResponse({ ok: false, error: "Opinię można dodać po zakończonej wizycie." }, 409);
    }

    const stored = (await readDatabase("reviews", accessToken)) ?? {};
    const alreadyReviewedBarber = Object.values(stored).some(
      (item) => item && item.userId === user.uid && item.barberId === appointment.barberId,
    );
    if (alreadyReviewedBarber) {
      return jsonResponse({ ok: false, error: "Opinię o tym barberze już dodano." }, 409);
    }

    const review = {
      barberId: appointment.barberId,
      userId: user.uid,
      rating: input.rating,
      text: input.text,
      authorName: publicAuthorName(appointment.clientName || user.displayName),
      serviceName: appointment.serviceName,
      createdAt: Date.now(),
    };
    // "null_etag" only matches a node that does not exist yet, so a visit can be reviewed just once.
    const created = await writeDatabaseIfUnchanged(
      `reviews/${encodeURIComponent(appointmentId)}`,
      review,
      "null_etag",
      accessToken,
    );
    if (!created) return jsonResponse({ ok: false, error: "Ta wizyta ma już opinię." }, 409);
    return jsonResponse({ ok: true, review: toPublicReview(appointmentId, review) });
  } catch {
    return jsonResponse({ ok: false, error: "Nie udało się obsłużyć opinii. Spróbuj ponownie." }, 503);
  }
};

export default handler;
