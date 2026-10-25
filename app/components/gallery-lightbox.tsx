"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { galleryImageSources } from "../../shared/gallery-images.mjs";
import GalleryPhoto from "./gallery-photo";
import SalonDialog from "./salon-dialog";
import type { SalonImage } from "./salon-manager";

const SWIPE_DISTANCE = 48;

/** `caption` returns the text under a photo (the barber who did the haircut), or "" for none. */
type Props = { photos: SalonImage[]; index: number; onIndex: (index: number) => void; onClose: () => void; caption?: (photo: SalonImage) => string };

/** Full-screen viewer: arrow keys, swipe, previous/next buttons and a position counter. */
export default function GalleryLightbox({ photos, index, onIndex, onClose, caption }: Props) {
  const count = photos.length;
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const go = useCallback((step: number) => {
    if (count < 2) return;
    setDirection(step > 0 ? "next" : "prev");
    onIndex((index + step + count) % count);
  }, [count, index, onIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // Warm the neighbours so a swipe never waits for the network.
  useEffect(() => {
    for (const step of [1, -1]) {
      const neighbour = photos[(index + step + count) % count];
      if (neighbour) new Image().src = galleryImageSources(neighbour).src;
    }
  }, [index, count, photos]);

  // Keep the current thumbnail in view inside the filmstrip (scrolls only the strip, never the page).
  useEffect(() => {
    const bar = strip.current; const current = bar?.querySelector<HTMLElement>("[aria-current]");
    if (bar && current) bar.scrollTo({ left: current.offsetLeft - (bar.clientWidth - current.clientWidth) / 2, behavior: "smooth" });
  }, [index]);

  const photo = photos[index];
  if (!photo) return null;
  const source = galleryImageSources(photo);
  const text = caption?.(photo) ?? "";
  return <SalonDialog title={photo.alt || "Zdjęcie galerii"} onClose={onClose} wide>
    <div
      className="lightbox-stage"
      onPointerDown={event => { swipe.current = { x: event.clientX, y: event.clientY }; }}
      onPointerUp={event => {
        const start = swipe.current; swipe.current = null;
        if (!start) return;
        const dx = event.clientX - start.x; const dy = event.clientY - start.y;
        if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
      }}
      onPointerCancel={() => { swipe.current = null; }}
    >
      <span key={photo.id} className="lightbox-frame" data-direction={direction}>
        <img
          className="lightbox-photo"
          src={source.src}
          srcSet={source.srcSet}
          sizes="100vw"
          alt={photo.alt}
          draggable={false}
        />
      </span>
    </div>
    {text && <p className="lightbox-caption">
      <span key={photo.id} role="img" aria-label={text}>
        {[...text].map((letter, position) => <span key={position} aria-hidden="true" style={{ animationDelay: `${position * 28}ms` }}>{letter === " " ? " " : letter}</span>)}
      </span>
    </p>}
    {count > 1 && <>
      <button type="button" className="lightbox-arrow prev" aria-label="Poprzednie zdjęcie" onClick={() => go(-1)}><ChevronLeft /></button>
      <button type="button" className="lightbox-arrow next" aria-label="Następne zdjęcie" onClick={() => go(1)}><ChevronRight /></button>
      <p className="lightbox-counter" role="status" aria-live="polite"><b>{String(index + 1).padStart(2, "0")}</b> / {String(count).padStart(2, "0")}</p>
      <div className="lightbox-strip" ref={strip}>
        {photos.map((item, position) => <button type="button" key={item.id} aria-label={`Zdjęcie ${position + 1}`} aria-current={position === index || undefined}
          onClick={() => { setDirection(position > index ? "next" : "prev"); onIndex(position); }}>
          <GalleryPhoto photo={item} sizes="72px" alt="" />
        </button>)}
      </div>
    </>}
  </SalonDialog>;
}
