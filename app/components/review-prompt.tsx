"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { Check, Star } from "lucide-react";

import { fetchMyReview, submitReview, type Review } from "../lib/reviews";
import ReviewStars from "./review-stars";

const MAX_TEXT = 400;
const ratingWords = ["", "Słabo", "Może być", "Dobrze", "Bardzo dobrze", "Świetnie"];
const BURST_RAYS = 8;
const CONFETTI_PIECES = 30;
const CONFETTI_SHAPES = ["star", "dot", "bar"] as const;

type Piece = { tx: number; ty: number; rot: number; delay: number; tone: number; shape: (typeof CONFETTI_SHAPES)[number] };

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Random only after a click, never during server rendering, so hydration cannot disagree.
const makeConfetti = (): Piece[] =>
  Array.from({ length: CONFETTI_PIECES }, (_, index) => ({
    tx: Math.round((Math.random() - 0.5) * 340),
    ty: Math.round(150 + Math.random() * 190),
    rot: Math.round((Math.random() - 0.5) * 900),
    delay: Math.round(Math.random() * 260),
    tone: index % 4,
    shape: CONFETTI_SHAPES[index % CONFETTI_SHAPES.length],
  }));

/**
 * Shown inside the details of a settled visit. The client rates the barber with stars and may add a
 * few words; sending it plays a short celebration and the form turns into a read-only "Twoja opinia".
 * Mount with `key={appointmentId}` so state never leaks between visits.
 */
export default function ReviewPrompt({ appointmentId, barberName, onSubmitted }: { appointmentId: string; barberName: string; onSubmitted?: () => void }) {
  const [existing, setExisting] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [burst, setBurst] = useState({ value: 0, id: 0 });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [confetti, setConfetti] = useState<Piece[] | null>(null);

  useEffect(() => {
    let stopped = false;
    fetchMyReview(appointmentId)
      .then((review) => { if (!stopped) setExisting(review); })
      .catch(() => undefined)
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [appointmentId]);

  // The confetti is only decoration: remove it once it has fallen.
  useEffect(() => {
    if (!confetti) return undefined;
    const timer = window.setTimeout(() => setConfetti(null), 2600);
    return () => window.clearTimeout(timer);
  }, [confetti]);

  if (loading) return null;

  if (existing) {
    return (
      <section className={`review-prompt is-done${confetti ? " is-celebrating" : ""}`} aria-label="Twoja opinia">
        {confetti ? (
          <span className="review-confetti" aria-hidden="true">
            {confetti.map((piece, index) => (
              <i
                key={index}
                className={`is-${piece.shape} tone-${piece.tone}`}
                style={{ "--tx": `${piece.tx}px`, "--ty": `${piece.ty}px`, "--rot": `${piece.rot}deg`, "--delay": `${piece.delay}ms` } as CSSProperties}
              />
            ))}
          </span>
        ) : null}
        <span className="review-done-mark" aria-hidden="true"><Check /></span>
        <p className="eyebrow">{confetti ? "Dziękujemy za opinię!" : "Twoja opinia"}</p>
        <ReviewStars rating={existing.rating} size="lg" animated />
        {existing.text ? <p className="review-prompt-text">{existing.text}</p> : null}
        <small>To dla nas bardzo ważne{barberName ? `, a ${barberName} na pewno się ucieszy` : ""}.</small>
      </section>
    );
  }

  const pick = (value: number) => {
    setRating(value);
    setBurst((current) => ({ value, id: current.id + 1 }));
  };

  const send = async () => {
    if (!rating || sending) return;
    setSending(true);
    setError("");
    try {
      const saved = await submitReview(appointmentId, rating, text);
      if (!prefersReducedMotion()) setConfetti(makeConfetti());
      setExisting(saved);
      onSubmitted?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Nie udało się wysłać opinii.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="review-prompt" aria-label="Oceń wizytę">
      <p className="eyebrow">Jak było{barberName ? ` u ${barberName}` : ""}?</p>
      <div className="review-prompt-stars" role="radiogroup" aria-label="Ocena">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} z 5: ${ratingWords[value]}`}
            className={value <= rating ? "is-filled" : ""}
            style={{ "--i": value - 1 } as CSSProperties}
            onClick={() => pick(value)}
          >
            {/* Re-keyed with the rating, so every pick replays the pop of the stars that light up. */}
            <Star key={`${rating}-${value <= rating}`} aria-hidden="true" />
            {burst.value === value ? (
              <span className="review-burst" key={burst.id} aria-hidden="true">
                {Array.from({ length: BURST_RAYS }, (_, ray) => (
                  <i key={ray} style={{ "--a": `${ray * (360 / BURST_RAYS)}deg` } as CSSProperties} />
                ))}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <small className="review-prompt-hint" aria-live="polite">
        <span key={rating}>{rating ? ratingWords[rating] : "Dotknij gwiazdki, aby ocenić"}</span>
      </small>
      <label>
        <span>Kilka słów (opcjonalnie)</span>
        <textarea
          value={text}
          maxLength={MAX_TEXT}
          rows={3}
          placeholder="Co Ci się podobało?"
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      {error ? <p className="modal-operation-error" role="alert">{error}</p> : null}
      <button className="review-prompt-send" type="button" disabled={!rating || sending} aria-busy={sending} onClick={() => void send()}>
        {sending ? "Wysyłanie..." : "Wyślij opinię"}
      </button>
    </section>
  );
}
