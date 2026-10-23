"use client";
import { useCallback, useState } from "react";
import { galleryImageSources } from "../../shared/gallery-images.mjs";
import type { SalonImage } from "./salon-manager";

type Props = {
  photo: SalonImage;
  /** CSS `sizes` hint: how wide the photo is rendered, so the browser picks the right file. */
  sizes: string;
  alt?: string;
  /** The first visible photo: load immediately and with high priority (it is the LCP image). */
  priority?: boolean;
};

/** Gallery image with responsive sizes, a blurred placeholder and a soft fade-in. */
export default function GalleryPhoto({ photo, sizes, alt = photo.alt, priority = false }: Props) {
  const source = galleryImageSources(photo);
  const [loaded, setLoaded] = useState(false);
  // A cached image can finish loading before React attaches onLoad; check on mount.
  const attach = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth > 0) setLoaded(true);
  }, []);
  return <span
    className={`gallery-photo${loaded ? " is-loaded" : ""}`}
    style={source.blur ? { backgroundImage: `url(${source.blur})` } : undefined}
  >
    <img
      ref={attach}
      src={source.src}
      srcSet={source.srcSet}
      sizes={source.srcSet ? sizes : undefined}
      width={source.width}
      height={source.height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(true)}
    />
  </span>;
}
