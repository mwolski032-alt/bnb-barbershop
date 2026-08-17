export const shouldApplyAppointmentSnapshot = (currentRevision, incomingRevision) => {
  const current = Number.isFinite(Number(currentRevision)) ? Number(currentRevision) : -1;
  const incoming = Math.max(0, Number(incomingRevision) || 0);
  return incoming >= current;
};
