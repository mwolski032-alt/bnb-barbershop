"use client";

import { memo, useEffect, useRef } from "react";

function BookingHero() {
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;

    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const heroHeight = Math.max(1, window.innerWidth * 0.5625);
        const progress = Math.min(1, Math.max(0, window.scrollY / (heroHeight * 0.62)));
        hero.style.opacity = String(1 - progress);
        hero.style.transform = `translateY(${-18 * progress}px) scale(${1 - 0.035 * progress})`;
        hero.style.filter = `saturate(${1 - 0.28 * progress}) brightness(${1 - 0.38 * progress})`;
        hero.closest(".app-shell")?.classList.toggle("hero-collapsed", progress > 0.48);
      });
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      hero.closest(".app-shell")?.classList.remove("hero-collapsed");
    };
  }, []);

  return (
    <div className="home-hero" ref={heroRef} aria-hidden="true">
      <picture>
        <source
          type="image/avif"
          srcSet="/brand/bnb-hero-960.avif 960w, /brand/bnb-hero-1440.avif 1440w"
          sizes="(max-width: 767px) 100vw, 720px"
        />
        <source
          type="image/webp"
          srcSet="/brand/bnb-hero-960.webp 960w, /brand/bnb-hero-1440.webp 1440w"
          sizes="(max-width: 767px) 100vw, 720px"
        />
        <img
          src="/brand/bnb-hero-1440.jpg"
          alt=""
          width="1440"
          height="811"
          decoding="async"
          fetchPriority="high"
        />
      </picture>
    </div>
  );
}

export default memo(BookingHero);
