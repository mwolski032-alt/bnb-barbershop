"use client";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Minus, Plus } from "lucide-react";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampPosition,
  coverScale,
  cropRegion,
  initialCrop,
  outputSize,
  zoomAt,
} from "../../shared/photo-crop.mjs";
import SalonDialog from "./salon-dialog";

type Props = {
  file: File;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
  onError: (message: string) => void;
};

type Frame = { zoom: number; x: number; y: number };

const KEY_STEP = 14;
const ZOOM_STEP = 0.25;

/** Lets the barber choose which part of a photo becomes the round profile picture. */
export default function PhotoCropDialog({ file, onCancel, onConfirm, onError }: Props) {
  const [viewport] = useState(() => Math.max(220, Math.min(320, window.innerWidth - 96)));
  const [url, setUrl] = useState("");
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [frame, setFrame] = useState<Frame>({ zoom: MIN_ZOOM, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const viewportBox = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastPinch = useRef(0);
  const saved = useRef("");

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const geometry = (current: Frame) => ({ width: natural?.width ?? 1, height: natural?.height ?? 1, viewport, ...current });
  const applyZoom = (nextZoom: number, focusX?: number, focusY?: number) =>
    setFrame((current) => (natural ? zoomAt(geometry(current), nextZoom, focusX, focusY) : current));
  const pan = (dx: number, dy: number) =>
    setFrame((current) => (natural ? { ...current, ...clampPosition({ ...geometry(current), x: current.x + dx, y: current.y + dy }) } : current));
  const localPoint = (event: PointerEvent | { clientX: number; clientY: number }) => {
    const box = viewportBox.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    lastPinch.current = 0;
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const active = [...pointers.current.values()];
    if (active.length >= 2) {
      const [first, second] = active;
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (lastPinch.current > 0) {
        const middle = localPoint({ clientX: (first.x + second.x) / 2, clientY: (first.y + second.y) / 2 });
        setFrame((current) => (natural ? zoomAt(geometry(current), current.zoom * (distance / lastPinch.current), middle.x, middle.y) : current));
      }
      lastPinch.current = distance;
    } else {
      pan(event.clientX - previous.x, event.clientY - previous.y);
    }
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    lastPinch.current = 0;
    if (pointers.current.size === 0) setDragging(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [KEY_STEP, 0], ArrowRight: [-KEY_STEP, 0], ArrowUp: [0, KEY_STEP], ArrowDown: [0, -KEY_STEP] };
    if (moves[event.key]) { event.preventDefault(); pan(...moves[event.key]); }
    else if (event.key === "+" || event.key === "=") { event.preventDefault(); applyZoom(frame.zoom + ZOOM_STEP); }
    else if (event.key === "-") { event.preventDefault(); applyZoom(frame.zoom - ZOOM_STEP); }
  };

  const scale = natural ? coverScale(natural.width, natural.height, viewport) * frame.zoom : 1;

  const render = () => {
    const element = image.current;
    if (!element || !natural) return "";
    const region = cropRegion(geometry(frame));
    const size = outputSize(region.size);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.imageSmoothingQuality = "high";
    context.drawImage(element, region.sx, region.sy, region.size, region.size, 0, 0, size, size);
    return canvas.toDataURL("image/webp", 0.86);
  };

  return (
    <SalonDialog
      title="Kadrowanie zdjęcia profilowego"
      className="photo-crop"
      onClose={() => { if (saved.current) onConfirm(saved.current); else onCancel(); }}
    >
      {(close) => (
        <>
          <h2>Ustaw kadr zdjęcia</h2>
          <p className="photo-crop-help" id="photo-crop-help">
            Przeciągnij zdjęcie, aby wybrać jego najlepszą część. Okrąg pokazuje, jak zobaczą je klienci.
          </p>
          <div
            ref={viewportBox}
            className={`photo-crop-viewport${dragging ? " is-dragging" : ""}`}
            style={{ width: viewport, height: viewport }}
            tabIndex={0}
            role="group"
            aria-label="Podgląd kadru. Strzałki przesuwają zdjęcie, plus i minus zmieniają powiększenie."
            aria-describedby="photo-crop-help"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onWheel={(event) => { const point = localPoint(event); applyZoom(frame.zoom * Math.exp(-event.deltaY * 0.0015), point.x, point.y); }}
            onKeyDown={onKeyDown}
          >
            {url ? (
              <img
                ref={image}
                src={url}
                alt=""
                draggable={false}
                style={natural ? { width: natural.width * scale, transform: `translate(${frame.x}px, ${frame.y}px)` } : { visibility: "hidden" }}
                onLoad={(event) => {
                  const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                  if (!width || !height) { onError("Nie udało się wczytać zdjęcia."); return; }
                  setNatural({ width, height });
                  setFrame({ zoom: MIN_ZOOM, ...initialCrop(width, height, viewport) });
                }}
                onError={() => onError("Nie udało się wczytać zdjęcia.")}
              />
            ) : null}
            <span className="photo-crop-mask" aria-hidden="true" />
          </div>
          <div className="photo-crop-zoom">
            <button type="button" className="salon-ghost" aria-label="Pomniejsz" disabled={!natural || frame.zoom <= MIN_ZOOM} onClick={() => applyZoom(frame.zoom - ZOOM_STEP)}><Minus aria-hidden="true" /></button>
            <input
              type="range"
              aria-label="Powiększenie"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={frame.zoom}
              disabled={!natural}
              onChange={(event) => applyZoom(Number(event.target.value))}
            />
            <button type="button" className="salon-ghost" aria-label="Powiększ" disabled={!natural || frame.zoom >= MAX_ZOOM} onClick={() => applyZoom(frame.zoom + ZOOM_STEP)}><Plus aria-hidden="true" /></button>
          </div>
          <div className="salon-confirm-actions">
            <button type="button" className="salon-ghost" onClick={close}>Anuluj</button>
            <button
              type="button"
              className="salon-cta"
              disabled={!natural}
              onClick={() => {
                const result = render();
                if (!result) { onError("Nie udało się przygotować zdjęcia."); return; }
                saved.current = result;
                close();
              }}
            >
              Zapisz kadr
            </button>
          </div>
        </>
      )}
    </SalonDialog>
  );
}
