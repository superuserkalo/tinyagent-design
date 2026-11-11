"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import type { ChatSummary } from "@/lib/client/runtime";
import HowItWorks, { REPO_URL } from "./how-it-works";
import { Close, FramedGitHub, Plus } from "./icons";
import { button, cn, Tip } from "./ui";

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

export function timeAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return relative.format(-seconds, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return relative.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, "hour");
  return relative.format(-Math.floor(hours / 24), "day");
}

/** TinyAgent, and smaller beside it, by Radian. A plain click opens a new design in place. */
export function Wordmark({ onHome }: { onHome: () => void }) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onHome();
  };
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 font-sans">
      <a href="/" onClick={click} aria-label="TinyAgent home" className="-mx-1 block px-1 py-1 text-[16px] font-semibold leading-5 tracking-[-0.03em] text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring">
        TinyAgent
      </a>
      <a href="https://radian.sh" target="_blank" rel="noopener noreferrer" className="shrink-0 whitespace-nowrap text-[11px] leading-4 text-fg-3 outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring">
        by Radian
      </a>
    </span>
  );
}

export function SourceLink() {
  return (
    <Tip label="view tinyagent-design source on GitHub">
      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="tinyagent-design source on GitHub (opens in a new tab)"
        className="grid size-8 shrink-0 place-items-center text-muted outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FramedGitHub />
      </a>
    </Tip>
  );
}

export function NewDesignButton({ onNew, compact = false }: { onNew: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      aria-label="new design"
      onClick={onNew}
      className={compact
        ? `${button.ghost} ${button.icon}`
        : `${button.plain} h-7 w-full justify-start gap-2 px-3 text-[13px] font-normal text-fg-2 hover:text-fg focus-visible:ring-offset-side`}
    >
      <Plus size={compact ? 14 : 12} />
      {!compact && "new design"}
    </button>
  );
}

export default function Sidebar({ chats, activeId, ready, now, onSelect, onNew, onDelete, account }: {
  chats: ChatSummary[];
  activeId: string;
  ready: boolean;
  now: number;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  account: ReactNode;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <aside className="flex h-full w-[min(82vw,280px)] shrink-0 flex-col overflow-hidden border-r border-side-line bg-side md:w-[var(--sidebar-width)]">
      {/* Text in this column starts 24px from the edge, like the composer's. */}
      <div className="flex h-12 items-center justify-between gap-3 pl-6 pr-[18px]">
        <Wordmark onHome={onNew} />
        <div className="flex items-center">
          <SourceLink />
          <HowItWorks />
        </div>
      </div>

      <div className="px-3 pt-3">
        <NewDesignButton onNew={onNew} />
      </div>

      <nav aria-label="chats" className="min-h-0 w-full flex-1 overflow-y-auto pb-2 pt-2">
        {ready && chats.length === 0 && <p className="px-6 py-1.5 text-[13px] leading-5 text-fg-3">No chats yet.</p>}
        {chats.map((chat) => {
          const active = chat.id === activeId;
          const armed = confirming === chat.id;
          return (
            <div key={chat.id} className="group/row relative" onPointerLeave={() => armed && setConfirming(null)}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onSelect(chat.id)}
                className="group/item block w-full min-w-0 px-3 text-left outline-none"
              >
                <span className={cn(
                  "block min-w-0 overflow-hidden px-3 py-1.5 group-focus-visible/item:ring-2 group-focus-visible/item:ring-ring",
                  active ? "bg-side-hover text-fg" : "text-fg-2 group-hover/item:bg-side-hover group-hover/item:text-fg",
                )}>
                  <span title={chat.title ?? "new chat"} className={cn(
                    "block truncate text-[13px] leading-5 group-hover/row:pr-6 group-focus-within/row:pr-6",
                    active ? "font-semibold" : "font-normal",
                    armed && "pr-14 group-hover/row:pr-14",
                  )}>
                    {chat.title ?? "new chat"}
                  </span>
                  <span className="mt-px flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] leading-4 text-fg-3">
                    {chat.busy && (
                      <>
                        <span className="ta-pulse size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
                        <span>working</span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <span className="tabular-nums">{timeAgo(chat.updatedAt, now)}</span>
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-label={armed ? `confirm delete ${chat.title ?? "new chat"}` : `delete ${chat.title ?? "new chat"}`}
                onClick={() => {
                  if (!armed) return setConfirming(chat.id);
                  setConfirming(null);
                  onDelete(chat.id);
                }}
                className={cn(
                  "absolute right-4 top-1 h-6 place-items-center outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/row:grid group-focus-within/row:grid",
                  armed ? "grid px-1.5 text-[11px] text-fg" : "hidden w-6 text-fg-3 hover:text-fg",
                )}
              >
                {armed ? "delete" : <Close className="size-3" />}
              </button>
            </div>
          );
        })}
      </nav>

      <div className="pb-4 pl-3 pr-3 pt-2">{account}</div>
    </aside>
  );
}
