import { useEffect } from "react";
import { getBackController } from "../lib/back-navigation";

export type BackLevel = { active: boolean; close: () => void };

type Options = {
  /** Name of this part of the UI. Different parts can report their own levels at the same time. */
  group?: string;
  /** Parts with a higher priority are closed first. */
  priority?: number;
};

/**
 * Lets the system Back button close the innermost open screen or dialog.
 * `levels` is ordered innermost first. While `suspended` (the booking wizard is open and manages
 * its own history entry) the whole mechanism does nothing.
 */
export function useBackNavigation(levels: BackLevel[], suspended: boolean, { group = "app", priority = 0 }: Options = {}) {
  // Runs after every render: pushing or trimming entries is idempotent and cheap.
  useEffect(() => {
    getBackController().update({ levels, suspended }, group, priority);
  });

  useEffect(() => () => getBackController().remove(group), [group]);
}