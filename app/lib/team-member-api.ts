import { getAuth } from "firebase/auth";

import { firebaseApp } from "./firebase";

/** Deletes a barber for good (owner only). Throws an Error whose message can be shown as it is. */
export const deleteTeamMember = async (barberId: string) => {
  const user = getAuth(firebaseApp).currentUser;
  if (!user) throw new Error("Sesja wygasła. Zaloguj się ponownie.");
  const response = await fetch("/api/team-member", {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ barberId }),
  });
  const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !result?.ok) throw new Error(result?.error || "Nie udało się usunąć barbera.");
};
