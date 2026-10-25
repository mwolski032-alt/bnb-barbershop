"use client";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import GalleryPhoto from "./gallery-photo";
import type { SalonImage } from "./salon-manager";

type Props = { photos: SalonImage[]; barberName: (photo: SalonImage) => string; onOpen: (index: number) => void };

const ALL = "";

/** "Show all photos" view: a bento mosaic that reveals on scroll, tilts under the pointer and filters by barber. */
export default function GalleryMosaic({ photos, barberName, onOpen }: Props) {
  const [barber, setBarber] = useState(ALL);
  const grid = useRef<HTMLDivElement>(null);
  const names = useMemo(() => [...new Set(photos.map(barberName).filter(Boolean))], [photos, barberName]);

  useEffect(() => {
    const tiles = grid.current?.querySelectorAll<HTMLElement>(".mosaic-tile");
    if (!tiles) return;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); }
    }), { threshold: 0.12 });
    tiles.forEach(tile => observer.observe(tile));
    return () => observer.disconnect();
  }, [photos]);

  const tilt = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "mouse") return;
    const tile = event.currentTarget; const box = tile.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width; const y = (event.clientY - box.top) / box.height;
    tile.style.setProperty("--tilt-y", `${(x - 0.5) * 12}deg`);
    tile.style.setProperty("--tilt-x", `${(0.5 - y) * 12}deg`);
    tile.style.setProperty("--glare-x", `${x * 100}%`);
    tile.style.setProperty("--glare-y", `${y * 100}%`);
  };
  const untilt = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
  };

  return <>
    {names.length > 1 && <div className="mosaic-filters" role="group" aria-label="Filtr według barbera">
      {[ALL, ...names].map(name => <button type="button" key={name || "all"} aria-pressed={barber === name} onClick={() => setBarber(name)}>{name || "Wszyscy"}</button>)}
    </div>}
    <div className="mosaic" ref={grid}>{photos.map((photo, index) => {
      const name = barberName(photo);
      return <button type="button" key={photo.id} className="mosaic-tile" data-dim={barber !== ALL && name !== barber ? "" : undefined}
        style={{ transitionDelay: `${Math.min(index, 8) * 60}ms` }}
        onPointerMove={tilt} onPointerLeave={untilt} onClick={() => onOpen(index)}
        aria-label={`Powiększ zdjęcie ${index + 1}: ${photo.alt}`}>
        <GalleryPhoto photo={photo} sizes="(max-width: 700px) 50vw, 330px" />
        <span className="mosaic-glare" aria-hidden="true" />
        <span className="mosaic-label"><b>{String(index + 1).padStart(2, "0")}</b>{name && <em>{name}</em>}</span>
      </button>;
    })}</div>
  </>;
}
