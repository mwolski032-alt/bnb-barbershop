import crypto from "node:crypto";

const TOKEN_VERSION = 1;
const TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const MAX_TOKEN_LENGTH = 4096;
const appointmentIdPattern = /^[^.#$\[\]/]{1,120}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const signingSecret = () => {
  const configured = String(process.env.NOTIFICATION_ACTION_SECRET || "").trim();
  const firebaseKey = String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const source = configured || firebaseKey;
  if (!source) throw new Error("Missing notification action signing secret.");
  return crypto
    .createHash("sha256")
    .update("bnb-notification-actions-v1\0")
    .update(source)
    .digest();
};

const signatureFor = (encodedPayload) =>
  crypto.createHmac("sha256", signingSecret()).update(encodedPayload).digest("base64url");

// What a token may do. The visit actions carry the exact visit they were issued for (version and schedule),
// so a stale button cannot touch a visit that has changed since. The waiting-list action names the entry.
export const CLIENT_CONFIRM_ACTION = "confirm_reschedule";
export const BARBER_CONFIRM_ACTION = "barber_confirm_reschedule";
export const BARBER_REFUSE_ACTION = "barber_refuse_reschedule";
export const DECLINE_OFFER_ACTION = "decline_waitlist_offer";
const appointmentActions = new Set([CLIENT_CONFIRM_ACTION, BARBER_CONFIRM_ACTION, BARBER_REFUSE_ACTION]);

const validAppointmentClaims = (claims) =>
  appointmentActions.has(claims?.action) &&
  appointmentIdPattern.test(String(claims.appointmentId || "")) &&
  appointmentIdPattern.test(String(claims.userId || "")) &&
  appointmentIdPattern.test(String(claims.scheduleOperationId || "")) &&
  datePattern.test(String(claims.dateKey || "")) &&
  timePattern.test(String(claims.startTime || "")) &&
  Number.isInteger(claims.appointmentVersion) &&
  claims.appointmentVersion >= 1;

const validOfferClaims = (claims) =>
  claims?.action === DECLINE_OFFER_ACTION &&
  appointmentIdPattern.test(String(claims.userId || "")) &&
  appointmentIdPattern.test(String(claims.waitlistId || "")) &&
  datePattern.test(String(claims.dateKey || "")) &&
  timePattern.test(String(claims.startTime || ""));

const validClaims = (claims) =>
  claims?.v === TOKEN_VERSION &&
  (validAppointmentClaims(claims) || validOfferClaims(claims)) &&
  Number.isInteger(claims.iat) &&
  Number.isInteger(claims.exp);

const sign = (claims) => {
  if (!validClaims(claims)) throw new Error("Invalid notification action claims.");
  const encodedPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${encodedPayload}.${signatureFor(encodedPayload)}`;
};

const lifetime = (now) => {
  const issuedAt = Math.floor(now / 1000);
  return { iat: issuedAt, exp: issuedAt + TOKEN_LIFETIME_SECONDS };
};

/** Token for one visit action. `userId` is who may use it: the client for a confirmation of a moved visit, the barber for his actions. */
export const createAppointmentActionToken = (action, appointment, userId, now = Date.now()) =>
  sign({
    v: TOKEN_VERSION,
    action,
    appointmentId: String(appointment?.id || ""),
    userId: String(userId || ""),
    scheduleOperationId: String(appointment?.lastOperationId || ""),
    dateKey: String(appointment?.dateKey || ""),
    startTime: String(appointment?.startTime || ""),
    appointmentVersion: Number(appointment?.version),
    ...lifetime(now),
  });

/** The client's "Potwierdź" on a visit the barber moved. */
export const createNotificationActionToken = (appointment, now = Date.now()) =>
  createAppointmentActionToken(CLIENT_CONFIRM_ACTION, appointment, appointment?.userId, now);

/** "Nie, dziękuję" on a waiting-list offer. */
export const createWaitlistOfferActionToken = (offer, now = Date.now()) =>
  sign({
    v: TOKEN_VERSION,
    action: DECLINE_OFFER_ACTION,
    userId: String(offer?.userId || ""),
    waitlistId: String(offer?.waitlistId || ""),
    dateKey: String(offer?.dateKey || ""),
    startTime: String(offer?.startTime || ""),
    ...lifetime(now),
  });

export const verifyNotificationActionToken = (token, now = Date.now()) => {
  const value = String(token || "");
  if (!value || value.length > MAX_TOKEN_LENGTH) return null;
  const [encodedPayload, signature, extra] = value.split(".");
  if (!encodedPayload || !signature || extra) return null;

  const expected = signatureFor(encodedPayload);
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const current = Math.floor(now / 1000);
    if (
      !validClaims(claims) ||
      claims.iat > current + 5 * 60 ||
      claims.exp <= current ||
      claims.exp > claims.iat + TOKEN_LIFETIME_SECONDS
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
};
