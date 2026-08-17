import {
  claimRateLimit,
  getAccessToken,
  getAdminContext,
  jsonResponse,
  verifyRequestUser,
} from "./_firebase-admin.mjs";
import {
  resolveNotificationSiteUrl,
  sendTestDeviceNotification,
} from "./_notification-service.mjs";

const handler = async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const user = await verifyRequestUser(request);
    if (!user) return jsonResponse({ ok: false, error: "Brak ważnej sesji." }, 401);

    const accessToken = await getAccessToken();
    const admin = await getAdminContext(user, accessToken);
    if (admin.isOwner) {
      return jsonResponse({ ok: false, error: "Powiadomienia właściciela są wyłączone." }, 403);
    }

    const { event, appointment: requestedAppointment } = await request.json();
    if (event !== "test_push" || !requestedAppointment?.id) {
      return jsonResponse(
        { ok: false, error: "Powiadomienia wizyt są uruchamiane wyłącznie przez backend." },
        400,
      );
    }

    const granted = await claimRateLimit(
      user.uid,
      `notification-test-${requestedAppointment.id}`,
      2_000,
      accessToken,
    );
    if (!granted) {
      return jsonResponse({ ok: false, error: "Powiadomienie zostało już wysłane." }, 429);
    }

    const result = await sendTestDeviceNotification({
      uid: user.uid,
      appointment: {
        ...requestedAppointment,
        id: String(requestedAppointment.id),
        userId: user.uid,
      },
      siteUrl: resolveNotificationSiteUrl(request),
    });
    return jsonResponse(result, result.ok ? 200 : 409);
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : "Unknown notification error." },
      500,
    );
  }
};

export default handler;
