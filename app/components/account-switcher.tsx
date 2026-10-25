"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { linkAnotherAccount, listAccounts, switchAccount, unlinkAccount, type AccountList } from "../lib/account-switch";
import { confirmAction } from "../lib/confirm-action";
import ProfileAvatar from "./profile-avatar";

const ROLE_LABEL = { owner: "Właściciel", barber: "Barber", client: "Konto" } as const;

/** Header menu for the owner and the accounts paired with theirs: switch between them without signing out. */
export default function AccountSwitcher() {
  const [data, setData] = useState<AccountList | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(() => listAccounts().then(setData).catch(() => setData(null)), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);

  if (!data || (!data.canLink && data.accounts.length < 2)) return null;
  const current = data.accounts.find(account => account.current) ?? data.accounts[0];

  async function run(key: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy(key); setError("");
    try { await task(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Nie udało się wykonać operacji."); setBusy(""); }
  }

  return <div className="acct-switch" ref={root}>
    <button type="button" className="acct-switch-button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(value => !value)}>
      <ProfileAvatar className="acct-switch-avatar" name={current?.name || "?"} photoUrl={current?.photoUrl} />
      <span className="acct-switch-label">Konta</span>
      <ChevronDown aria-hidden="true" />
    </button>
    {open && <div className="acct-switch-menu" role="menu">
      {data.accounts.map((account, index) => <div className="acct-switch-row" key={account.uid} style={{ animationDelay: `${60 + index * 55}ms` }}>
        <button type="button" role="menuitem" className={account.current ? "is-current" : ""} disabled={Boolean(busy)} aria-current={account.current || undefined}
          onClick={() => account.current ? setOpen(false) : void run(account.uid, () => switchAccount(account.uid))}>
          <ProfileAvatar className="acct-switch-avatar" name={account.name || account.email} photoUrl={account.photoUrl} />
          <span><strong>{account.name || account.email}</strong><small>{ROLE_LABEL[account.role]}</small></span>
          {busy === account.uid ? <i className="acct-switch-spinner" aria-label="Przełączam" /> : account.current ? <Check aria-hidden="true" /> : null}
        </button>
        {data.canLink && account.role !== "owner" && <button type="button" className="acct-switch-unlink" aria-label={`Odepnij konto ${account.name || account.email}`} disabled={Boolean(busy)}
          onClick={async () => {
            if (await confirmAction({ title: "Odpiąć to konto?", message: "Przestanie być dostępne w tym menu. Samo konto zostaje bez zmian.", confirmLabel: "Odepnij", tone: "danger" })) void run(`unlink-${account.uid}`, async () => { await unlinkAccount(account.uid); await load(); setBusy(""); });
          }}><X /></button>}
      </div>)}
      {data.canLink && <button type="button" className="acct-switch-add" style={{ animationDelay: `${60 + data.accounts.length * 55}ms` }} disabled={Boolean(busy)}
        onClick={() => void run("link", async () => { await linkAnotherAccount(); await load(); setBusy(""); })}>
        <Plus aria-hidden="true" />{busy === "link" ? "Czekam na logowanie…" : "Dodaj konto"}
      </button>}
      {error && <p className="acct-switch-error" role="alert">{error}</p>}
    </div>}
  </div>;
}
