"use client";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

const ARMED_MS = 4000;

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type" | "children"> & {
  onConfirm: () => void;
  /** What the same button says after the first tap. */
  confirmLabel?: ReactNode;
  children: ReactNode;
};

/**
 * A button for something that cannot be undone. The first tap only changes its label ("Na pewno?") and turns it
 * red; the action runs on a second tap on the same button. Leaving the button, or waiting a few seconds, puts it back.
 */
export default function ConfirmButton({ onConfirm, confirmLabel = "Na pewno?", children, className, disabled, ...rest }: Props) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);
  const stopTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stopTimer, []);
  useEffect(() => {
    if (disabled) {
      stopTimer();
      setArmed(false);
    }
  }, [disabled]);

  return (
    <button
      {...rest}
      type="button"
      className={className}
      disabled={disabled}
      data-armed={armed || undefined}
      onBlur={(event) => {
        stopTimer();
        setArmed(false);
        rest.onBlur?.(event);
      }}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          stopTimer();
          timer.current = window.setTimeout(() => setArmed(false), ARMED_MS);
          return;
        }
        stopTimer();
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
