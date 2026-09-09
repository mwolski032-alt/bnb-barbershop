/** Public profile projection: never spread private Firebase records here. */
export function instagramUrl(value = "") {
  const text = String(value).trim();
  if (!text) return "";
  const handle = text.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/$/, "");
  return /^[a-zA-Z0-9._]{1,30}$/.test(handle) ? `https://www.instagram.com/${handle}/` : "";
}

export function publicBarber(id, member = {}, profile = {}) {
  return {
    id,
    displayName: String(profile.displayName || member.name || "Barber"),
    photoUrl: String(profile.photoUrl || ""),
    bio: String(profile.bio || ""),
    specialties: String(profile.specialties || ""),
    instagram: instagramUrl(profile.instagram),
  };
}
