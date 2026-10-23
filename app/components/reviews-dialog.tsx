"use client";
import { useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import { Star } from "lucide-react";

import SalonDialog from "./salon-dialog";
import ReviewStars from "./review-stars";
import { useCountUp } from "../hooks/use-count-up";
import {
  emptyReviewStats,
  reviewAverageLabel,
  reviewCountLabel,
  type Review,
  type ReviewSummary,
} from "../lib/reviews";

const dateFormatter = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long", year: "numeric" });

// Fixed positions, so the server and the browser draw the same sparkles.
const sparkles = [
  { x: 8, y: 12, s: 1, d: 0 }, { x: 22, y: 4, s: .6, d: 700 }, { x: 38, y: 16, s: .8, d: 300 },
  { x: 58, y: 6, s: 1.1, d: 1100 }, { x: 74, y: 14, s: .7, d: 500 }, { x: 90, y: 5, s: .9, d: 900 },
  { x: 15, y: 30, s: .5, d: 1400 }, { x: 84, y: 28, s: .6, d: 200 },
];

type Props = {
  reviews: Review[];
  summary: ReviewSummary;
  barbers: { id: string; displayName: string }[];
  onClose: () => void;
};

// Each card follows the pointer with a soft golden spotlight (position written straight to CSS variables).
const trackPointer = (event: PointerEvent<HTMLElement>) => {
  const card = event.currentTarget;
  const box = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${event.clientX - box.left}px`);
  card.style.setProperty("--my", `${event.clientY - box.top}px`);
};

/** The reviews live in their own dialog so the salon page itself stays as it is. */
export default function ReviewsDialog({ reviews, summary, barbers, onClose }: Props) {
  const [barberId, setBarberId] = useState("all");
  const nameOf = (id: string) => barbers.find((barber) => barber.id === id)?.displayName ?? "";
  const visible = useMemo(
    () => (barberId === "all" ? reviews : reviews.filter((review) => review.barberId === barberId)),
    [reviews, barberId],
  );
  const stats = barberId === "all" ? summary : summary.byBarber[barberId] ?? emptyReviewStats;
  // Only barbers who have been reviewed get a filter chip.
  const filters = barbers.filter((barber) => (summary.byBarber[barber.id]?.count ?? 0) > 0);
  const score = useCountUp(stats.average, { decimals: 1, duration: 1300, delay: 250 });
  const mostVotes = Math.max(1, ...stats.distribution);

  return (
    <SalonDialog title="Opinie klientów" onClose={onClose} className="salon-reviews-dialog">
      <div className="reviews-sparkles" aria-hidden="true">
        {sparkles.map((sparkle, index) => (
          <i key={index} style={{ "--x": `${sparkle.x}%`, "--y": `${sparkle.y}%`, "--s": sparkle.s, "--d": `${sparkle.d}ms` } as CSSProperties} />
        ))}
      </div>
      <span className="salon-overline">OPINIE KLIENTÓW</span>
      <h2>Co mówią o nas klienci</h2>

      {stats.count > 0 ? (
        // Re-keyed per barber, so switching the filter replays the whole reveal.
        <div className="reviews-hero" key={barberId}>
          <div className="reviews-score">
            <strong aria-label={`Średnia ocena ${reviewAverageLabel(stats.average)} na 5`}>{reviewAverageLabel(score)}</strong>
            <span aria-hidden="true">/ 5</span>
          </div>
          <div className="reviews-hero-side">
            <ReviewStars rating={stats.average} size="lg" animated label={`Średnia ocena ${reviewAverageLabel(stats.average)} na 5`} />
            <small>{reviewCountLabel(stats.count)}</small>
          </div>
          <ol className="reviews-histogram" aria-label="Rozkład ocen">
            {[5, 4, 3, 2, 1].map((value, index) => {
              const count = stats.distribution[value - 1] ?? 0;
              return (
                <li key={value} style={{ "--i": index, "--pct": count / mostVotes } as CSSProperties}>
                  <span>{value}<Star aria-hidden="true" /></span>
                  <i><b /></i>
                  <em>{count}</em>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {filters.length > 1 ? (
        <div className="salon-reviews-filters" role="group" aria-label="Filtruj opinie według barbera">
          <button type="button" aria-pressed={barberId === "all"} onClick={() => setBarberId("all")}>Wszyscy</button>
          {filters.map((barber) => (
            <button key={barber.id} type="button" aria-pressed={barberId === barber.id} onClick={() => setBarberId(barber.id)}>
              {barber.displayName}
            </button>
          ))}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="salon-empty" role="status">Pierwsze opinie pojawią się tutaj po wizytach naszych klientów.</p>
      ) : (
        <ul className="salon-reviews-list" key={barberId}>
          {visible.map((review, index) => (
            <li key={review.id} style={{ "--i": Math.min(index, 8) } as CSSProperties} onPointerMove={trackPointer}>
              <div className="salon-review-head">
                <strong>{review.authorName}</strong>
                <ReviewStars rating={review.rating} animated />
              </div>
              {review.text ? <p>{review.text}</p> : null}
              <small>
                {[nameOf(review.barberId), review.serviceName, review.createdAt ? dateFormatter.format(review.createdAt) : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </li>
          ))}
        </ul>
      )}
    </SalonDialog>
  );
}
