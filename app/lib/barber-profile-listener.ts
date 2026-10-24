import { onValue, ref, type Database } from "firebase/database";

/**
 * The parts of a barber's profile any signed-in person may read (the same ones the public salon page shows).
 * The profile also holds the barber's phone and e-mail: the database rules let only the owner and the barber
 * himself read the profile as a whole, so everybody else has to ask for these fields one by one.
 */
export const PUBLIC_PROFILE_FIELDS = ["displayName", "photoUrl", "bio", "specialties", "instagram", "updatedAt"] as const;

/** Calls `onChange` with the profile whenever it changes. Returns the function that stops listening. */
export function listenToBarberProfile(
  database: Database,
  barberId: string,
  canReadAll: boolean,
  onChange: (profile: Record<string, unknown> | null) => void,
): () => void {
  if (canReadAll) {
    return onValue(
      ref(database, `barbers/${barberId}/profile`),
      (snapshot) => onChange(snapshot.val() as Record<string, unknown> | null),
      () => undefined,
    );
  }

  const values: Record<string, unknown> = {};
  const stops = PUBLIC_PROFILE_FIELDS.map((field) =>
    onValue(
      ref(database, `barbers/${barberId}/profile/${field}`),
      (snapshot) => {
        if (snapshot.exists()) values[field] = snapshot.val();
        else delete values[field];
        onChange(Object.keys(values).length > 0 ? { ...values } : null);
      },
      () => undefined,
    ),
  );
  return () => stops.forEach((stop) => stop());
}
