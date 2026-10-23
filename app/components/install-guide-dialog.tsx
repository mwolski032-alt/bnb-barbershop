"use client";

import { useState, useRef, useEffect } from "react";
import { Compass, Share2, SquarePlus, EllipsisVertical, Download, CheckCircle2, X, Smartphone, Apple, ChevronRight, Bot, ArrowLeft } from "lucide-react";
import { type InstallPlatform, type InstallGuideIcon } from "../lib/booking-types";

export const installGuideSteps: Record<
  InstallPlatform,
  Array<{ title: string; description: string; icon: InstallGuideIcon }>
> = {
  ios: [
    {
      title: "Otwórz stronę w Safari",
      description: "Instrukcja instalacji na iPhonie i iPadzie działa bezpośrednio w Safari.",
      icon: "safari",
    },
    {
      title: "Naciśnij Udostępnij",
      description: "Na dole ekranu wybierz ikonę kwadratu ze strzałką skierowaną do góry.",
      icon: "share",
    },
    {
      title: "Dodaj do ekranu początkowego",
      description: "Przewiń listę działań i wybierz opcję „Do ekranu początkowego”.",
      icon: "add",
    },
    {
      title: "Potwierdź przyciskiem Dodaj",
      description: "Ikona BNB pojawi się na ekranie głównym i będzie otwierać aplikację pełnoekranowo.",
      icon: "done",
    },
  ],
  android: [
    {
      title: "Otwórz stronę w Chrome",
      description: "Na telefonie z Androidem otwórz stronę BNB w przeglądarce Google Chrome.",
      icon: "chrome",
    },
    {
      title: "Otwórz menu Chrome",
      description: "Naciśnij trzy kropki w prawym górnym rogu przeglądarki.",
      icon: "menu",
    },
    {
      title: "Wybierz instalację",
      description: "Naciśnij „Zainstaluj aplikację” lub „Dodaj do ekranu głównego”.",
      icon: "download",
    },
    {
      title: "Potwierdź instalację",
      description: "Po potwierdzeniu ikona BNB pojawi się na ekranie głównym telefonu.",
      icon: "done",
    },
  ],
};

export function ChromeBrandIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="#ea4335" d="M12 12 3.34 7A10 10 0 0 1 20.66 7Z" />
      <path fill="#34a853" d="m12 12 8.66-5A10 10 0 0 1 12 22Z" />
      <path fill="#fbbc05" d="m12 12v10A10 10 0 0 1 3.34 7Z" />
      <circle cx="12" cy="12" r="4.55" fill="#fff" />
      <circle cx="12" cy="12" r="3.75" fill="#4285f4" />
    </svg>
  );
}

export function InstallStepGraphic({ icon }: { icon: InstallGuideIcon }) {
  if (icon === "chrome") return <ChromeBrandIcon className="install-guide-step-svg" />;
  if (icon === "safari") return <Compass aria-hidden="true" />;
  if (icon === "share") return <Share2 aria-hidden="true" />;
  if (icon === "add") return <SquarePlus aria-hidden="true" />;
  if (icon === "menu") return <EllipsisVertical aria-hidden="true" />;
  if (icon === "download") return <Download aria-hidden="true" />;
  return <CheckCircle2 aria-hidden="true" />;
}

export function InstallGuideDialog({
  onClose,
  initialPlatform = null,
}: {
  onClose: () => void;
  initialPlatform?: InstallPlatform | null;
}) {
  const [platform, setPlatform] = useState<InstallPlatform | null>(initialPlatform);
  const [stepIndex, setStepIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    document.body.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyboard);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const steps = platform ? installGuideSteps[platform] : [];
  const currentStep = steps[stepIndex];
  const returnToPlatformChoice = () => {
    setPlatform(null);
    setStepIndex(0);
  };
  const goBack = () => {
    if (stepIndex === 0) {
      returnToPlatformChoice();
    } else {
      setStepIndex((current) => current - 1);
    }
  };

  return (
    <div
      className="install-guide-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="install-guide-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-guide-title"
      >
        <div className="install-guide-grabber" aria-hidden="true" />
        <button className="install-guide-close" type="button" onClick={onClose} aria-label="Zamknij">
          <X aria-hidden="true" />
        </button>

        {!platform ? (
          <>
            <header className="install-guide-heading">
              <span className="install-guide-heading-icon" aria-hidden="true">
                <Smartphone />
              </span>
              <div>
                <p className="eyebrow">Szybka instalacja</p>
                <h2 id="install-guide-title">Wybierz swój telefon</h2>
              </div>
            </header>
            <p className="install-guide-lead">
              Pokażemy dokładnie, gdzie nacisnąć. Instalacja zajmie mniej niż minutę.
            </p>
            <div className="install-platform-list">
              <button
                className="install-platform-option"
                type="button"
                onClick={() => {
                  setPlatform("ios");
                  setStepIndex(0);
                }}
              >
                <span className="install-platform-logo ios" aria-hidden="true">
                  <Apple />
                </span>
                <span className="install-platform-copy">
                  <strong>iPhone lub iPad</strong>
                  <small>Instrukcja dla Safari</small>
                </span>
                <span className="install-platform-browser safari" aria-hidden="true">
                  <Compass />
                </span>
                <ChevronRight className="install-platform-chevron" aria-hidden="true" />
              </button>
              <button
                className="install-platform-option"
                type="button"
                onClick={() => {
                  setPlatform("android");
                  setStepIndex(0);
                }}
              >
                <span className="install-platform-logo android" aria-hidden="true">
                  <Bot />
                </span>
                <span className="install-platform-copy">
                  <strong>Telefon z Androidem</strong>
                  <small>Instrukcja dla Chrome</small>
                </span>
                <span className="install-platform-browser" aria-hidden="true">
                  <ChromeBrandIcon />
                </span>
                <ChevronRight className="install-platform-chevron" aria-hidden="true" />
              </button>
            </div>
          </>
        ) : (
          <div className="install-guide-step" aria-live="polite">
            <div className="install-guide-step-topline">
              <button className="install-guide-back" type="button" onClick={goBack}>
                <ArrowLeft aria-hidden="true" />
                Wstecz
              </button>
              <span>{platform === "ios" ? "iPhone / Safari" : "Android / Chrome"}</span>
            </div>
            <div className="install-guide-progress" aria-label={`Krok ${stepIndex + 1} z ${steps.length}`}>
              {steps.map((step, index) => (
                <span
                  className={index <= stepIndex ? "active" : ""}
                  key={step.title}
                  aria-hidden="true"
                />
              ))}
            </div>
            <span className={`install-guide-step-icon ${currentStep.icon}`} aria-hidden="true">
              <InstallStepGraphic icon={currentStep.icon} />
            </span>
            <p className="install-guide-step-counter">
              Krok {stepIndex + 1} z {steps.length}
            </p>
            <h2 id="install-guide-title">{currentStep.title}</h2>
            <p className="install-guide-step-description">{currentStep.description}</p>
            <div className="install-guide-actions">
              <button className="install-guide-secondary" type="button" onClick={goBack}>
                Wstecz
              </button>
              <button
                className="install-guide-primary"
                type="button"
                onClick={() => {
                  if (stepIndex === steps.length - 1) {
                    onClose();
                  } else {
                    setStepIndex((current) => current + 1);
                  }
                }}
              >
                {stepIndex === steps.length - 1 ? "Gotowe" : "Dalej"}
                {stepIndex === steps.length - 1 ? (
                  <CheckCircle2 aria-hidden="true" />
                ) : (
                  <ChevronRight aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default InstallGuideDialog;
