import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_ZOOM, MIN_ZOOM, clampPosition, clampZoom, coverScale, cropRegion, initialCrop, outputSize, zoomAt,
} from "../shared/photo-crop.mjs";

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);
const wide = { width: 4000, height: 2000, viewport: 300 };
const tall = { width: 1500, height: 3000, viewport: 300 };

test("the starting crop shows the largest centred square of any photo", () => {
  for (const photo of [wide, tall, { width: 800, height: 800, viewport: 300 }]) {
    const start = initialCrop(photo.width, photo.height, photo.viewport);
    const region = cropRegion({ ...photo, zoom: 1, ...start });
    near(region.size, Math.min(photo.width, photo.height), "square side");
    near(region.sx, (photo.width - region.size) / 2, "centred horizontally");
    near(region.sy, (photo.height - region.size) / 2, "centred vertically");
  }
});

test("dragging can never reveal empty space around the photo", () => {
  const start = { ...wide, zoom: 1, ...initialCrop(wide.width, wide.height, wide.viewport) };
  const farLeft = clampPosition({ ...start, x: -99999, y: 99999 });
  const scale = coverScale(wide.width, wide.height, wide.viewport);
  near(farLeft.x, wide.viewport - wide.width * scale, "right edge sticks to the viewport");
  near(farLeft.y, 0, "top edge sticks to the viewport");
  const farRight = clampPosition({ ...start, x: 99999, y: -99999 });
  near(farRight.x, 0, "left edge");
  near(farRight.y, wide.viewport - wide.height * scale, "bottom edge (no room: covers exactly)");
});

test("zoom is limited and keeps the point under the finger in place", () => {
  assert.equal(clampZoom(0.2), MIN_ZOOM);
  assert.equal(clampZoom(99), MAX_ZOOM);
  assert.equal(clampZoom(Number.NaN), MIN_ZOOM);
  const start = { ...tall, zoom: 1, ...initialCrop(tall.width, tall.height, tall.viewport) };
  const focus = { x: 220, y: 90 };
  const photoPointBefore = [(focus.x - start.x) / (coverScale(tall.width, tall.height, tall.viewport) * 1), (focus.y - start.y) / coverScale(tall.width, tall.height, tall.viewport)];
  const zoomed = zoomAt(start, 2.5, focus.x, focus.y);
  const scale = coverScale(tall.width, tall.height, tall.viewport) * zoomed.zoom;
  near((focus.x - zoomed.x) / scale, photoPointBefore[0], "same photo point under focus (x)");
  near((focus.y - zoomed.y) / scale, photoPointBefore[1], "same photo point under focus (y)");
});

test("zooming in shrinks the saved region and zooming out never exceeds the photo", () => {
  const start = { ...wide, zoom: 1, ...initialCrop(wide.width, wide.height, wide.viewport) };
  const zoomed = { ...start, ...zoomAt(start, 4) };
  near(cropRegion(zoomed).size, 2000 / 4, "a quarter of the short side at 4x");
  const out = { ...start, ...zoomAt(zoomed, 0.1) };
  near(cropRegion(out).size, 2000, "back to the full short side");
  const region = cropRegion({ ...wide, zoom: 1, x: -99999, y: -99999 });
  assert.ok(region.sx >= 0 && region.sx + region.size <= wide.width + 1e-6);
  assert.ok(region.sy >= 0 && region.sy + region.size <= wide.height + 1e-6);
});

test("the saved image is never upscaled and is capped at 512 px", () => {
  assert.equal(outputSize(3000), 512);
  assert.equal(outputSize(300.4), 300);
  assert.equal(outputSize(0.2), 1);
});

test("the cropper is wired into the profile photo flow instead of a blind centre crop", () => {
  const home = readFileSync(new URL("../app/booking-home.tsx", import.meta.url), "utf8");
  const handler = home.slice(home.indexOf("const handleProfilePhotoChange"), home.indexOf("const saveBarberProfile"));
  assert.match(handler, /setCropFile\(file\)/);
  assert.doesNotMatch(handler, /resizeProfilePhoto/);
  assert.match(home, /<PhotoCropDialog/);
  const dialog = readFileSync(new URL("../app/components/photo-crop-dialog.tsx", import.meta.url), "utf8");
  for (const part of ["onPointerDown", "onWheel", "type=\"range\"", "ArrowLeft", "Zapisz kadr", "cropRegion", "toDataURL(\"image/webp\""]) {
    assert.ok(dialog.includes(part), part);
  }
});
