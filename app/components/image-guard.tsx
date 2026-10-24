"use client";
import { useEffect } from "react";

/**
 * Mounted once in the layout. A picture on a page cannot be made impossible to copy (a screenshot always
 * works), but the two easy ways are closed: dragging it onto the desktop, and "save image" from the
 * right-click or long-press menu. Everything else on the page keeps working, including dragging
 * appointments in the calendar, which are not images.
 */
export default function ImageGuard() {
  useEffect(() => {
    const isImage = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest("img, picture, canvas"));
    const stop = (event: Event) => {
      if (isImage(event.target)) event.preventDefault();
    };
    document.addEventListener("dragstart", stop, true);
    document.addEventListener("contextmenu", stop, true);
    return () => {
      document.removeEventListener("dragstart", stop, true);
      document.removeEventListener("contextmenu", stop, true);
    };
  }, []);
  return null;
}
