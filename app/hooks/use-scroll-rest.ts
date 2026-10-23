"use client";
import { useEffect } from "react";

/**
 * Marks the page as scrolling while a finger or wheel is moving it, and for a moment after.
 * Decorative loops (see telegram-feel.css) pause meanwhile, so scrolling gets the whole frame budget.
 */
export function useScrollRest() {
  useEffect(() => {
    const root = document.documentElement;
    let timer = 0;
    const onScroll = () => {
      if (!root.classList.contains("is-scrolling")) root.classList.add("is-scrolling");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => root.classList.remove("is-scrolling"), 160);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
      root.classList.remove("is-scrolling");
    };
  }, []);
}
