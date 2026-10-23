"use client";
import { useScrollRest } from "../hooks/use-scroll-rest";
import { useTapFeedback } from "../hooks/use-tap-feedback";

/** Mounted once in the layout: every tap gets a springy answer, and scrolling gets the frame budget. */
export default function TapFeedback() {
  useTapFeedback();
  useScrollRest();
  return null;
}
