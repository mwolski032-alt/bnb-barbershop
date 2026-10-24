// Deleting a barber for good. It is allowed only when nothing refers to them any more: a barber with visits (past
// ones included) or waiting-list entries is switched off instead, so the history and the owner's statistics stay
// whole. Pure function, covered by unit tests; the server reads the data and writes the resulting updates.

export const planBarberRemoval = ({ barberId, members, barberAppointments, barberWaitlist, clients, gallery }) => {
  const member = members?.[barberId];
  if (!member) return { error: "Nie znaleziono tego barbera.", status: 404 };

  const visits = Object.keys(barberAppointments ?? {}).length;
  if (visits > 0) {
    return {
      error: `Ten barber ma zapisane wizyty (${visits}). Wyłącz jego konto zamiast usuwać, żeby nie stracić historii i statystyk.`,
      status: 409,
    };
  }
  const waiting = Object.keys(barberWaitlist ?? {}).length;
  if (waiting > 0) {
    return {
      error: `Ten barber ma osoby na liście rezerwowej (${waiting}). Wyłącz jego konto albo najpierw usuń je z listy.`,
      status: 409,
    };
  }

  const updates = {
    [`team/barbers/${barberId}`]: null,
    [`barbers/${barberId}`]: null,
    [`appointmentSync/barbers/${barberId}`]: null,
  };
  // Clients linked to this barber lose the link, and gallery photos credited to them lose the credit
  // (the database rules refuse a photo that names a barber who no longer exists).
  for (const [clientId, client] of Object.entries(clients ?? {})) {
    if (client?.barberIds?.[barberId] !== undefined) updates[`clients/${clientId}/barberIds/${barberId}`] = null;
  }
  for (const [photoId, photo] of Object.entries(gallery ?? {})) {
    if (photo?.barberId === barberId) updates[`shopfront/gallery/${photoId}/barberId`] = null;
  }
  return { updates };
};
