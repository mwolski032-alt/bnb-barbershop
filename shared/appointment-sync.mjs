export const shouldApplyAppointmentSnapshot = (currentRevision, incomingRevision) => {
  const current = Number.isFinite(Number(currentRevision)) ? Number(currentRevision) : -1;
  const incoming = Math.max(0, Number(incomingRevision) || 0);
  return incoming >= current;
};

/**
 * @param {{
 *   step: string,
 *   signedInBarberId: string | null,
 *   selectedBarberId: string | null,
 *   activeBarberIds?: string[],
 * }} context
 */
export const resolveActiveBarberId = ({
  step,
  signedInBarberId,
  selectedBarberId,
  activeBarberIds = [],
}) => {
  if (step === "admin" && signedInBarberId) return signedInBarberId;
  return selectedBarberId || signedInBarberId || activeBarberIds[0] || "";
};

/**
 * @param {{
 *   activeBarberId: string,
 *   loadedBarberId: string,
 *   isLoading?: boolean,
 *   error?: string,
 * }} context
 */
export const isServiceCatalogReady = ({
  activeBarberId,
  loadedBarberId,
  isLoading = false,
  error = "",
}) =>
  Boolean(activeBarberId) &&
  loadedBarberId === activeBarberId &&
  !isLoading &&
  !error;
