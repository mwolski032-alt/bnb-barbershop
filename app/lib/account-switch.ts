import { deleteApp, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithCustomToken, signInWithPopup, signOut } from "firebase/auth";
import { firebaseApp } from "./firebase";

export type SwitchableAccount = {
  uid: string;
  name: string;
  email: string;
  photoUrl: string;
  role: "owner" | "barber" | "client";
  current: boolean;
};
export type AccountList = { canLink: boolean; accounts: SwitchableAccount[] };

const endpoint = "/api/account-switch";

const call = async (body: Record<string, unknown>) => {
  const user = getAuth(firebaseApp).currentUser;
  if (!user) throw new Error("Zaloguj się ponownie.");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Nie udało się wykonać operacji.");
  return data;
};

export const listAccounts = async (): Promise<AccountList> => {
  const data = await call({ action: "list" });
  return { canLink: data.canLink === true, accounts: Array.isArray(data.accounts) ? data.accounts : [] };
};

/** Signs in as another account of the same owner, then reloads so the whole app starts clean as that account. */
export async function switchAccount(uid: string) {
  const { token } = await call({ action: "switch", uid });
  await signInWithCustomToken(getAuth(firebaseApp), String(token));
  window.location.reload();
}

/** The owner signs in to the second account in a throw-away Firebase app, so the current session is untouched. */
export async function linkAnotherAccount() {
  const secondary = initializeApp(firebaseApp.options, `bnb-link-${Date.now()}`);
  try {
    const auth = getAuth(secondary);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const result = await signInWithPopup(auth, provider);
    await call({ action: "link", linkToken: await result.user.getIdToken() });
    await signOut(auth);
  } finally {
    await deleteApp(secondary).catch(() => undefined);
  }
}

export const unlinkAccount = (uid: string) => call({ action: "unlink", uid });
