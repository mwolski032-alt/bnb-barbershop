import { createRoot } from "react-dom/client";
import SalonDialog from "../components/salon-dialog";

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" styles the confirm button as a destructive action. */
  tone?: "default" | "danger";
};

/**
 * Ask for confirmation in the app's own dialog instead of the browser's `window.confirm`.
 * Resolves true only when the confirm button is pressed; Esc, backdrop and Cancel resolve false.
 */
export function confirmAction({ title, message, confirmLabel = "Potwierdź", cancelLabel = "Anuluj", tone = "default" }: ConfirmOptions) {
  return new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let answer = false;
    const finish = () => {
      root.unmount();
      host.remove();
      resolve(answer);
    };
    root.render(
      <SalonDialog title={title} onClose={finish} className="salon-confirm">
        {(close) => (
          <>
            <h2>{title}</h2>
            {message && <p className="salon-confirm-message">{message}</p>}
            <div className="salon-confirm-actions">
              <button type="button" className="salon-ghost" onClick={close}>{cancelLabel}</button>
              <button
                type="button"
                className={`salon-cta${tone === "danger" ? " salon-danger" : ""}`}
                onClick={() => { answer = true; close(); }}
              >
                {confirmLabel}
              </button>
            </div>
          </>
        )}
      </SalonDialog>,
    );
  });
}
