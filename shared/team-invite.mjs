// The owner adds a barber by e-mail and a display name. The card waits without a Google account (`userId` is
// empty); the first time that person signs in with Google using that e-mail, the server links the account. The
// card stays switched off until the owner switches it on: only then can the barber work and appear on the booking page.
// Pure functions, covered by unit tests, shared by the owner's panel and the sign-in check.

export const BARBER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
export const ADMIN_SECTIONS = ["schedule", "clients", "analytics", "work", "services", "profile", "gallery"];
/** A new barber can fill in their own profile and nothing else; the owner opens the other sections. */
export const NEW_BARBER_ACCESS = Object.fromEntries(ADMIN_SECTIONS.map((section) => [section, section === "profile"]));

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export const normalizeInviteEmail = (value) => String(value ?? "").trim().toLocaleLowerCase("pl");
export const isInviteEmail = (value) => {
  const email = normalizeInviteEmail(value);
  return email.length <= 100 && EMAIL_PATTERN.test(email);
};

/** A short id from the name ("Łukasz K." -> "lukasz-k-x7q2"), unique among the existing ones. */
export const makeBarberId = (name, existingIds = [], random = Math.random) => {
  const slug = String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/gi, "l")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  const taken = new Set(existingIds);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = Math.floor(random() * 36 ** 4).toString(36).padStart(4, "0");
    const id = `${slug || "barber"}-${suffix}`;
    if (!taken.has(id)) return id;
  }
  throw new Error("Nie udało się utworzyć identyfikatora barbera.");
};

/** The team record of a barber who has not signed in yet. */
export const buildInvitedMember = ({ id, name, email, index = 0, now = Date.now() }) => ({
  id,
  name: String(name).trim(),
  label: `Barber ${index + 1}`,
  accent: index % 2 === 0 ? "blue" : "mint",
  userId: "",
  email: normalizeInviteEmail(email),
  // Off until the owner switches it on, also after the first sign-in: nobody appears on the booking page unasked.
  active: false,
  access: { ...NEW_BARBER_ACCESS },
  invitedAt: now,
  createdAt: now,
  updatedAt: now,
});

export const isInvitePending = (member) => !String(member?.userId ?? "").trim();

/**
 * Looks for the card waiting for this person. `members` is the whole team; the e-mail must come from a
 * verified Google sign-in. Returns { id } to claim, { conflict: true } when more than one card waits for the
 * same address, or null.
 */
export const findPendingInvite = (members, email, emailVerified) => {
  const wanted = normalizeInviteEmail(email);
  if (!wanted || emailVerified !== true) return null;
  const matches = Object.entries(members ?? {}).filter(
    ([, member]) => isInvitePending(member) && normalizeInviteEmail(member?.email) === wanted,
  );
  if (matches.length === 0) return null;
  return matches.length === 1 ? { id: matches[0][0] } : { conflict: true };
};

/** The card after the first sign-in: linked to the account, with `active` left as the owner has it (off). */
export const claimInvite = (member, uid, now = Date.now()) => ({
  ...member,
  userId: uid,
  claimedAt: now,
  updatedAt: now,
});
