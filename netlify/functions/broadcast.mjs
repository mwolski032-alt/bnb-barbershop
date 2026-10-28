import {
  claimRateLimit,
  getAccessToken,
  getAdminContext,
  jsonResponse,
  patchDatabase,
  readDatabase,
  readDatabaseQuery,
  readTeamMember,
  verifyRequestUser,
} from "./_firebase-admin.mjs";
import {
  collectBroadcastDevices,
  resolveNotificationSiteUrl,
  sendBroadcastPush,
} from "./_notification-service.mjs";
import {
  BROADCAST_COOLDOWN_MS,
  broadcastAudience,
  canBroadcast,
  cleanBroadcastText,
} from "../../shared/broadcast.mjs";

export const config = {
  path: "/api/broadcast",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

const OWNER_NAME = "BNB Barbershop";
const PHOTO = /^data:image\/(?:webp|jpeg|png);base64,/;

// "Napisz do klientów": the owner or a barber sends a short hand-written push. `preview` only counts who would get it;
// `send` delivers it. The sender is whoever is signed in: a barber writes as themselves, the owner writes as the company.
export default async function handler(request) {
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  try {
    const user = await verifyRequestUser(request);
    if (!user) return jsonResponse({ ok: false, error: "Brak ważnej sesji." }, 401);
    const accessToken = await getAccessToken();
    const context = await getAdminContext(user, accessToken);
    if (!context.isAdmin || !context.active) {
      return jsonResponse({ ok: false, error: "Tylko właściciel i barberzy mogą pisać do klientów." }, 403);
    }
    const barberId = context.isOwner ? "" : context.barberId;
    const member = barberId ? await readTeamMember(barberId, accessToken) : {};
    if (!canBroadcast({ isOwner: context.isOwner, member })) {
      return jsonResponse({ ok: false, error: "Właściciel wyłączył Ci wysyłanie wiadomości do klientów." }, 403);
    }

    const body = await request.json().catch(() => ({}));
    const action = body?.action === "send" ? "send" : "preview";
    const text = cleanBroadcastText(body?.text);
    if (action === "send" && !text) return jsonResponse({ ok: false, error: "Wpisz treść wiadomości." }, 400);

    const [team, clients, favoriteProfiles] = await Promise.all([
      readDatabase("team", accessToken),
      readDatabase("clients", accessToken),
      barberId
        ? readDatabaseQuery("clientProfiles", { orderBy: "favoriteBarberId", equalTo: barberId }, accessToken)
        : Promise.resolve(null),
    ]);
    const excludedUids = [team?.owner?.userId, user.uid, ...Object.values(team?.barbers ?? {}).map((item) => item?.userId)];
    const deviceUids = context.isOwner
      ? Object.keys((await readDatabase("notificationTokens", accessToken)) ?? {})
      : [];
    const audience = broadcastAudience({
      barberId,
      clients: clients ?? {},
      favoriteUids: Object.keys(favoriteProfiles ?? {}),
      deviceUids,
      excludedUids,
    });
    const devices = await collectBroadcastDevices(accessToken, audience);
    const reachable = new Set(devices.map((device) => device.uid)).size;

    const siteUrl = resolveNotificationSiteUrl(request);
    let title = OWNER_NAME;
    let icon = new URL("/icons/icon-192.png", siteUrl).href;
    if (barberId) {
      const [displayName, photoUrl, updatedAt] = await Promise.all([
        readDatabase(`barbers/${encodeURIComponent(barberId)}/profile/displayName`, accessToken),
        readDatabase(`barbers/${encodeURIComponent(barberId)}/profile/photoUrl`, accessToken),
        readDatabase(`barbers/${encodeURIComponent(barberId)}/profile/updatedAt`, accessToken),
      ]);
      title = String(displayName || member.name || "Barber").trim();
      icon = PHOTO.test(String(photoUrl ?? ""))
        ? new URL(`/api/barber-photo/${encodeURIComponent(barberId)}?v=${Number(updatedAt) || 1}`, siteUrl).href
        : "";
    }

    if (action === "preview") {
      return jsonResponse({ ok: true, recipients: audience.length, reachable, title });
    }
    if (reachable === 0) {
      return jsonResponse({ ok: false, error: "Nikt z klientów nie ma jeszcze włączonych powiadomień." }, 409);
    }
    if (!(await claimRateLimit(user.uid, "broadcast", BROADCAST_COOLDOWN_MS, accessToken))) {
      return jsonResponse({ ok: false, error: "Wiadomość poszła przed chwilą. Odczekaj kilka minut przed kolejną." }, 429);
    }

    const sentAt = Date.now();
    const result = await sendBroadcastPush({
      accessToken,
      devices,
      title,
      body: text,
      icon,
      tag: `broadcast-${sentAt}`,
      siteUrl,
      // A barber's message opens the booking with that barber already chosen; the owner's opens the app.
      ...(barberId ? { query: { barber: barberId }, linkEvent: "rebook" } : {}),
    });
    await patchDatabase(`broadcastLog/${sentAt}-${user.uid}`, {
      senderUid: user.uid,
      senderName: title,
      barberId,
      text,
      recipients: audience.length,
      reachable,
      sent: result.sent,
      failed: result.failed,
      sentAt,
    }, accessToken).catch(() => undefined);
    return jsonResponse({ ok: true, recipients: audience.length, reachable, sent: result.sent, failed: result.failed });
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : "Nie udało się wysłać wiadomości." },
      500,
    );
  }
}
