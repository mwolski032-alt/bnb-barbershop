// Geometry of the profile photo cropper. The photo sits inside a square viewport; `x` and `y` are the
// photo's top-left corner relative to the viewport (always <= 0 so the photo covers it) and `zoom`
// multiplies the "cover" scale (zoom 1 shows the largest centred square).

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const OUTPUT_SIZE = 512;

/** Scale at which the photo exactly covers the viewport. */
export const coverScale = (width, height, viewport) => viewport / Math.min(width, height);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const clampZoom = (zoom) => clamp(Number.isFinite(zoom) ? zoom : MIN_ZOOM, MIN_ZOOM, MAX_ZOOM);

/** Keep the photo covering the viewport on both axes. */
export function clampPosition({ width, height, viewport, zoom, x, y }) {
  const scale = coverScale(width, height, viewport) * zoom;
  return {
    x: clamp(x, viewport - width * scale, 0),
    y: clamp(y, viewport - height * scale, 0),
  };
}

/** Centred, fully covering starting position. */
export function initialCrop(width, height, viewport) {
  const scale = coverScale(width, height, viewport);
  return clampPosition({ width, height, viewport, zoom: 1, x: (viewport - width * scale) / 2, y: (viewport - height * scale) / 2 });
}

/** Change the zoom while the point under (focusX, focusY) stays where it is. */
export function zoomAt({ width, height, viewport, zoom, x, y }, nextZoom, focusX = viewport / 2, focusY = viewport / 2) {
  const target = clampZoom(nextZoom);
  const scale = coverScale(width, height, viewport) * zoom;
  const nextScale = coverScale(width, height, viewport) * target;
  const pointX = (focusX - x) / scale;
  const pointY = (focusY - y) / scale;
  return { zoom: target, ...clampPosition({ width, height, viewport, zoom: target, x: focusX - pointX * nextScale, y: focusY - pointY * nextScale }) };
}

/** The square of the original photo that the viewport currently shows, in the photo's own pixels. */
export function cropRegion({ width, height, viewport, zoom, x, y }) {
  const scale = coverScale(width, height, viewport) * zoom;
  const size = Math.min(viewport / scale, width, height);
  return {
    sx: clamp(-x / scale, 0, width - size),
    sy: clamp(-y / scale, 0, height - size),
    size,
  };
}

/** Pixel size of the saved image: never upscaled, at most OUTPUT_SIZE. */
export const outputSize = (regionSize) => Math.max(1, Math.min(OUTPUT_SIZE, Math.round(regionSize)));
