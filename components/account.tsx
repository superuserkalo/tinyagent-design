"use client";

import { useState } from "react";
import { button, Popover, PopoverContent, PopoverTrigger } from "./ui";

export type AccountState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; email: string | null; promptsLeft: number | null };

/** The foot of the sidebar: Sign in, or the radian.sh account with a way out. */
export default function Account({ account, onSignIn, onSignOut }: {
  account: AccountState;
  onSignIn: () => void;
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  if (account.status === "loading") return <div className="h-8" aria-hidden="true" />;
  if (account.status === "signed-out") {
    return (
      <button type="button" onClick={onSignIn} className={`${button.plain} h-8 w-full justify-start px-3 font-normal text-fg-2 hover:text-fg focus-visible:ring-offset-side`}>
        Sign in
      </button>
    );
  }
  const item = "flex min-h-8 w-full items-center px-2.5 text-left text-sm outline-none hover:bg-hover focus-visible:bg-hover disabled:opacity-45";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={`${button.plain} h-8 w-full justify-start px-3 font-normal text-fg-2 hover:text-fg data-[state=open]:bg-hover`}>
          <span className="truncate">{account.email ?? "Radian account"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-56 p-1">
        <p className="truncate px-2.5 py-1.5 text-xs text-muted">{account.email ?? "Signed in"}</p>
        <a href="https://radian.sh/account" target="_blank" rel="noopener noreferrer" className={item}>radian.sh account</a>
        <button type="button" disabled={leaving} className={item} onClick={() => {
          setLeaving(true);
          void onSignOut().finally(() => { setLeaving(false); setOpen(false); });
        }}>
          {leaving ? "signing out…" : "sign out"}
        </button>
      </PopoverContent>
    </Popover>
  );
}
