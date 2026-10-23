import { getAuth } from "firebase/auth";

import { firebaseApp } from "./firebase";

export type Review = {
  id: string;
  barberId: string;
  rating: number;
  text: string;
  authorName: string;
  serviceName: string;
  createdAt: number;
};

export type ReviewStats = {
  count: number;
  average: number;
  /** Index 0 is the number of 1-star reviews, index 4 of 5-star ones. */
  distribution: number[];
};

export type ReviewSummary = ReviewStats & { byBarber: Record<string, ReviewStats> };

export const emptyReviewStats: ReviewStats = { count: 0, average: 0, distribution: [0, 0, 0, 0, 0] };
export const emptyReviewSummary: ReviewSummary = { ...emptyReviewStats, byBarber: {} };

const formatAverage = (average: number) => average.toFixed(1).replace(".", ",");

export const reviewCountLabel = (count: number) => {
  if (count === 1) return "1 opinia";
  const lastTwo = count % 100;
  const last = count % 10;
  return `${count} ${last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14) ? "opinie" : "opinii"}`;
};

export const reviewAverageLabel = (average: number) => formatAverage(average);

export const fetchPublicReviews = async (signal?: AbortSignal) => {
  const response = await fetch("/.netlify/functions/reviews", { signal, cache: "no-store" });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error("Nie udało się wczytać opinii.");
  return {
    reviews: (Array.isArray(result.reviews) ? result.reviews : []) as Review[],
    summary: (result.summary ?? emptyReviewSummary) as ReviewSummary,
  };
};

const authorizedHeaders = async () => {
  const user = getAuth(firebaseApp).currentUser;
  if (!user) throw new Error("Sesja wygasła. Zaloguj się ponownie.");
  return {
    Authorization: `Bearer ${await user.getIdToken()}`,
    "Content-Type": "application/json",
  };
};

export const fetchMyReview = async (appointmentId: string) => {
  const response = await fetch(
    `/.netlify/functions/reviews?appointmentId=${encodeURIComponent(appointmentId)}`,
    { headers: await authorizedHeaders(), cache: "no-store" },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || "Nie udało się sprawdzić opinii.");
  return (result.review ?? null) as Review | null;
};

/** The barbers this client has already reviewed; each client may review each barber once. */
export const fetchReviewedBarberIds = async () => {
  const response = await fetch("/.netlify/functions/reviews?mine=1", {
    headers: await authorizedHeaders(),
    cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || "Nie udało się sprawdzić opinii.");
  return (Array.isArray(result.reviewedBarberIds) ? result.reviewedBarberIds : []) as string[];
};

export const submitReview =async (appointmentId: string, rating: number, text: string) => {
  const response = await fetch("/.netlify/functions/reviews", {
    method: "POST",
    headers: await authorizedHeaders(),
    body: JSON.stringify({ appointmentId, rating, text }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || "Nie udało się wysłać opinii.");
  return result.review as Review;
};
