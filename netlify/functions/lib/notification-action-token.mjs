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

const validClaims = (claims) =>
  claims?.v === TOKEN_VERSION &&
  claims?.action === "confirm_reschedule" &&
  appointmentIdPattern.test(String(claims.appointmentId || "")) &&
  appointmentIdPattern.test(String(claims.userId || "")) &&
  appointmentIdPattern.test(String(claims.scheduleOperationId || "")) &&
  datePattern.test(String(claims.dateKey || "")) &&
  timePattern.test(String(claims.startTime || "")) &&
  Number.isInteger(claims.appointmentVersion) &&
  claims.appointmentVersion >= 1 &&
  Number.isInteger(claims.iat) &&
  Number.isInteger(claims.exp);

export const createNotificationActionToken = (appointment, now = Date.now()) => {
  const issuedAt = Math.floor(now / 1000);
  const claims = {
    v: TOKEN_VERSION,
    action: "confirm_reschedule",
    appointmentId: String(appointment?.id || ""),
    userId: String(appointment?.userId || ""),
    scheduleOperationId: String(appointment?.lastOperationId || ""),
    dateKey: String(appointment?.dateKey || ""),
    startTime: String(appointment?.startTime || ""),
    appointmentVersion: Number(appointment?.version),
    iat: issuedAt,
    exp: issuedAt + TOKEN_LIFETIME_SECONDS,
  };
  if (!validClaims(claims)) throw new Error("Invalid appointment notification action claims.");
  const encodedPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${encodedPayload}.${signatureFor(encodedPayload)}`;
};

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
