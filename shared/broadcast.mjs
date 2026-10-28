// "Napisz do klientów": a barber (or the owner) sends one short push to the people it concerns.

export const BROADCAST_MAX_CHARS = 200;
// A guard against a double tap or a typo sent twice, not a limit on how often an emergency may be sent.
export const BROADCAST_COOLDOWN_MS = 5 * 60_000;

export const cleanBroadcastText = (value) =>
  String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, BROADCAST_MAX_CHARS)
    .trim();

/** The owner can switch a barber's messages off in the team screen. Anything but an explicit `true` leaves them on. */
export const canBroadcast = ({ isOwner, member }) => Boolean(isOwner) || member?.broadcastBlocked !== true;

/**
 * Who receives the message, as account ids.
 * - A barber reaches clients who have ever had a visit with them (and did not get removed from their list),
 *   plus anyone who picked them as their favourite.
 * - The owner (`barberId` empty) reaches everyone: all known clients and every account with a push device.
 * The team (owner and all barbers) is never a recipient, nor is the sender.
 */
export const broadcastAudience = ({ barberId = "", clients = {}, favoriteUids = [], deviceUids = [], excludedUids = [] }) => {
  const excluded = new Set(excludedUids.filter(Boolean).map(String));
  const audience = new Set();
  const add = (uid) => {
    const id = String(uid ?? "").trim();
    if (id && !excluded.has(id)) audience.add(id);
  };

  for (const client of Object.values(clients ?? {})) {
    if (!client?.userId) continue;
    if (!barberId) add(client.userId);
    else if (client.barberIds?.[barberId] === true && client.hiddenFor?.[barberId] !== true) add(client.userId);
  }
  if (barberId) favoriteUids.forEach(add);
  else deviceUids.forEach(add);
  return [...audience];
};
