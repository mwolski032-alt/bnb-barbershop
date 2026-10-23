// Client reviews of a barber. One review per settled visit, stored under reviews/{appointmentId}.

export const MAX_REVIEW_TEXT = 400;
export const PUBLIC_REVIEW_LIMIT = 100;

export const normalizeReviewInput = (body = {}) => {
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "Wybierz ocenę od 1 do 5 gwiazdek." };
  }
  const text = String(body.text ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, MAX_REVIEW_TEXT);
  return { rating, text };
};

// Public pages show "Jan K." instead of the full name.
export const publicAuthorName = (fullName) => {
  const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Klient";
  const first = parts[0].slice(0, 30);
  return parts.length > 1 ? `${first} ${Array.from(parts[parts.length - 1])[0].toUpperCase()}.` : first;
};

export const toPublicReview = (id, review) => ({
  id,
  barberId: String(review.barberId ?? ""),
  rating: Number(review.rating),
  text: String(review.text ?? ""),
  authorName: String(review.authorName ?? "Klient"),
  serviceName: String(review.serviceName ?? ""),
  createdAt: Number(review.createdAt) || 0,
});

const isValidStored = (review) =>
  review && Number.isInteger(Number(review.rating)) && Number(review.rating) >= 1 && Number(review.rating) <= 5 &&
  review.barberId;

const emptyEntry = () => ({ count: 0, sum: 0, distribution: [0, 0, 0, 0, 0] });
const addTo = (entry, rating) => {
  entry.count += 1;
  entry.sum += rating;
  entry.distribution[rating - 1] += 1;
};

/** `distribution[0]` is the number of 1-star reviews, `distribution[4]` of 5-star ones. */
export const summarizeReviews = (reviews) => {
  const total = emptyEntry();
  const byBarber = {};
  for (const review of reviews) {
    addTo(total, review.rating);
    addTo((byBarber[review.barberId] ??= emptyEntry()), review.rating);
  }
  const finish = (entry) => ({
    count: entry.count,
    average: entry.count ? Math.round((entry.sum / entry.count) * 10) / 10 : 0,
    distribution: entry.distribution,
  });
  return {
    ...finish(total),
    byBarber: Object.fromEntries(Object.entries(byBarber).map(([barberId, entry]) => [barberId, finish(entry)])),
  };
};

/** Newest first. The summary covers every review; the list is trimmed to the latest ones. */
export const buildPublicReviews = (stored) => {
  const all = Object.entries(stored ?? {})
    .filter(([, review]) => isValidStored(review))
    .map(([id, review]) => toPublicReview(id, review))
    .sort((a, b) => b.createdAt - a.createdAt);
  return { reviews: all.slice(0, PUBLIC_REVIEW_LIMIT), summary: summarizeReviews(all) };
};
