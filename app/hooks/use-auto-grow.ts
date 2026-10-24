import { useLayoutEffect, useRef } from "react";

/** A textarea that is always tall enough for its whole text, so nothing has to be scrolled to be read. */
export function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [value]);
  return ref;
}
