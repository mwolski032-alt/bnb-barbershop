// Answers to a visit given without internet ("I'll be there", "cancel") wait here and are sent once the
// connection is back. Booking and moving a visit are never queued: they need the live calendar.
// Pure functions, covered by unit tests; storage and sending live in the app.

export const QUEUEABLE_ACTIONS = ["attend_client", "cancel_client"];
export const MAX_QUEUE_LENGTH = 20;
/** A queued answer older than this is dropped: the visit has long been decided another way. */
export const MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const isQueueableAction = (action) => QUEUEABLE_ACTIONS.includes(action);

const isValidItem = (item) =>
  item && typeof item === "object" &&
  isQueueableAction(item.action) &&
  typeof item.operationId === "string" && item.operationId.length > 0 &&
  typeof item.appointmentId === "string" && item.appointmentId.length > 0 &&
  Number.isInteger(item.expectedVersion) && item.expectedVersion >= 0 &&
  Number.isFinite(item.queuedAt);

/** Reads whatever was stored, keeping only well-formed, fresh items. */
export const sanitizeQueue = (raw, now = Date.now()) =>
  (Array.isArray(raw) ? raw : [])
    .filter((item) => isValidItem(item) && now - item.queuedAt <= MAX_QUEUE_AGE_MS)
    .slice(-MAX_QUEUE_LENGTH);

/**
 * Adds an answer to the queue. For one visit only the latest intent counts: a cancellation replaces a
 * queued "I'll be there", and nothing follows a cancellation. Repeating an answer changes nothing.
 */
export const enqueueOfflineAction = (queue, item) => {
  if (!isValidItem(item)) return queue;
  const forVisit = queue.filter((queued) => queued.appointmentId === item.appointmentId);
  if (forVisit.some((queued) => queued.action === "cancel_client")) return queue;
  if (forVisit.some((queued) => queued.action === item.action)) return queue;
  const others = item.action === "cancel_client"
    ? queue.filter((queued) => queued.appointmentId !== item.appointmentId)
    : queue;
  return [...others, item].slice(-MAX_QUEUE_LENGTH);
};

/** The list of visits as the client left it: queued cancellations are gone, queued confirmations are marked. */
export const applyQueuedActions = (appointments, queue) => {
  let result = appointments;
  for (const item of queue) {
    result = item.action === "cancel_client"
      ? result.filter((appointment) => appointment.id !== item.appointmentId)
      : result.map((appointment) => appointment.id === item.appointmentId
        ? { ...appointment, attendanceConfirmedAt: appointment.attendanceConfirmedAt ?? item.queuedAt }
        : appointment);
  }
  return result;
};

export const removeQueuedAction =(queue, operationId) =>
  queue.filter((item) => item.operationId !== operationId);

/**
 * What to do with a queued item after the server answered (or did not):
 *  - "sent": the server took it;
 *  - "retry": no connection or a server fault, keep it for the next time;
 *  - "dropped": the server refused (visit changed, closed or gone), the answer no longer applies.
 */
export const classifyReplayResult = ({ ok, status }) => {
  if (ok) return "sent";
  if (!Number.isFinite(status) || status === 0 || status === 408 || status === 429 || status >= 500) return "retry";
  return "dropped";
};

export const describeDropped = (items) => {
  if (items.length === 0) return "";
  return items.length === 1
    ? "Jedna odpowiedź zapisana offline nie mogła zostać wysłana, bo wizyta zdążyła się zmienić."
    : `${items.length} odpowiedzi zapisanych offline nie mogło zostać wysłanych, bo wizyty zdążyły się zmienić.`;
};
