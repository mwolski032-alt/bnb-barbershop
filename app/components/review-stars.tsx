import type { CSSProperties } from "react";
import { Star } from "lucide-react";

/**
 * Row of five stars. `animated` makes the filled ones pop in one after another (the first paint of a
 * rating); `size` picks the star size from the stylesheet.
 */
export default function ReviewStars({ rating, label, animated = false, size = "md" }: {
  rating: number;
  label?: string;
  animated?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const filled = Math.round(rating);
  return (
    <span className={`review-stars is-${size}${animated ? " is-animated" : ""}`} role="img" aria-label={label ?? `Ocena ${rating} na 5`}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star key={value} aria-hidden="true" className={value <= filled ? "is-filled" : ""} style={{ "--i": value - 1 } as CSSProperties} />
      ))}
    </span>
  );
}
