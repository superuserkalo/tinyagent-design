"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { api, setDevUser } from "@/lib/client/api";
import type { AttachedImage } from "@/lib/client/images";
import { DesignRuntime, PromptError, type Notice, type RuntimeState } from "@/lib/client/runtime";
import { signOut } from "@/lib/client/hanko";
import { buildTranscript } from "@/lib/transcript";
import Account, { type AccountState } from "./account";
import { FreePromptsContext } from "./how-it-works";
import Composer, { type ComposerHandle, type Quota } from "./composer";
import { Close, Menu, PanelLeft } from "./icons";
import PreviewPane, { ExportMenu } from "./preview-pane";
import Sidebar, { NewDesignButton, Wordmark } from "./sidebar";
import SignInDialog from "./sign-in-dialog";
import Transcript, { ActivityLine } from "./transcript";
import { button, cn } from "./ui";

const LOADING: RuntimeState = {
  ready: false, chats: [], notice: null,
  active: {
    id: "draft", records: [], stamps: new Map(), designs: [], running: false, liveText: "", partialText: "", phase: null,
    startedAt: null, draft: null, pending: null, watching: false, resumedAt: null,
  },
};
const AGENT_WIDTH = { min: 320, max: 640 };
let pageRuntime: DesignRuntime | null = null;
const SIDEBAR_WIDTH = { min: 224, max: 320 };

function useRuntime(runtime: DesignRuntime | null): RuntimeState {
  return useSyncExternalStore(
    runtime?.subscribe ?? (() => () => {}),
    runtime?.snapshot ?? (() => LOADING),
    () => LOADING,
  );
}

export default function DesignApp({ model: initialModel, freePrompts: initialFree, devTools }: { model: string; freePrompts: number; devTools: boolean }) {
  const [runtime, setRuntime] = useState<DesignRuntime | null>(null);
  const [scripted, setScripted] = useState(false);
  const [account, setAccount] = useState<AccountState>({ status: "loading" });
  const [signIn, setSignIn] = useState<{ open: boolean; atFlow: boolean }>({ open: false, atFlow: false });
  const [viewing, setViewing] = useState<string | null>(null);
  const [pane, setPane] = useState<"preview" | "chat">("preview");
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [model, setModel] = useState(initialModel);
  const [freePrompts, setFreePrompts] = useState(initialFree);
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pendingPrompt = useRef<{ text: string; images: AttachedImage[] } | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const thread = useRef<HTMLDivElement>(null);
  const state = useRuntime(runtime);
  const active = state.active;

  const loadAccount = useCallback(async (): Promise<boolean> => {
    try {
      const response = await api<{ user: { email: string | null } | null; promptsLeft: number | null; model: string; freePrompts: number }>("/api/me");
      const body = response.body;
      if (body.model) setModel(body.model);
      if (typeof body.freePrompts === "number") setFreePrompts(body.freePrompts);
      setAccount(body.user ? { status: "signed-in", email: body.user.email, promptsLeft: body.promptsLeft } : { status: "signed-out" });
      return Boolean(body.user);
    } catch {
      setAccount({ status: "signed-out" });
      return false;
    }
  }, []);

  // One runtime per tab. Chats come from the server; a run a reload interrupted resumes.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isScripted = devTools && params.get("scripted") === "1";
    setScripted(isScripted);
    // Development only: act as a named local user (?as=name), no sign-in. Scripted runs default to "dev".
    const devName = params.get("as");
    if (devTools && (isScripted || devName)) setDevUser(devName && /^[a-z0-9-]{1,32}$/.test(devName) ? devName : "dev");
    setCollapsed(document.documentElement.classList.contains("sidebar-collapsed"));
    // One per page: React's development double-run of effects must not open a second
    // runtime, which would resume the same interrupted run twice.
    if (pageRuntime) {
      setRuntime(pageRuntime);
      void loadAccount();
      return;
    }
    const instance = pageRuntime = new DesignRuntime({
      scripted: isScripted,
      slowTool: isScripted && params.get("slowtool") === "1",
      onPromptsLeft: (left) => setAccount((current) => current.status === "signed-in" ? { ...current, promptsLeft: left } : current),
      onRunEnd: () => { if (!isScripted) void loadAccount(); },
    });
    setRuntime(instance);
    if (devTools) (window as unknown as { __tinyagent?: unknown }).__tinyagent = instance.debug();
    void loadAccount().then((signedIn) => instance.start(params.get("s"), signedIn));
  }, [devTools, loadAccount]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { setNotice(state.notice); }, [state.notice]);

  // Cmd/Ctrl+B folds the sidebar away, as in most editors.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      setCollapsed((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("sidebar-collapsed", collapsed);
    try { localStorage.setItem("ta-sidebar-collapsed", collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

  const versions = useMemo(() => new Map(active.designs.map((design, index) => [design.id, index + 1])), [active.designs]);
  const entries = useMemo(
    () => buildTranscript(active.id, active.records, active.stamps, versions, {
      running: active.running, text: active.liveText, watching: active.watching, resumedAt: active.resumedAt, partialText: active.partialText,
    }),
    [active.id, active.records, active.stamps, versions, active.running, active.liveText, active.watching, active.resumedAt, active.partialText],
  );

  // Follow the conversation while it grows, unless the reader scrolled up.
  const pinned = useRef(true);
  useEffect(() => {
    const element = thread.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [entries, active.pending]);

  const setUrl = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("s", id);
    else url.searchParams.delete("s");
    window.history.replaceState(window.history.state, "", url);
  };

  const newDesign = useCallback(() => {
    runtime?.newDesign();
    setViewing(null);
    setDrawer(false);
    setPane("preview");
    setUrl(null);
    composer.current?.focus();
  }, [runtime]);

  const select = useCallback((id: string) => {
    void runtime?.select(id);
    setViewing(null);
    setDrawer(false);
    setUrl(id);
  }, [runtime]);

  const openSignIn = (atFlow: boolean) => setSignIn({ open: true, atFlow });

  const send = useCallback(async (text: string, images: AttachedImage[] = []): Promise<boolean> => {
    if (!runtime) return false;
    if (!scripted) {
      if (account.status === "loading") return false;
      if (account.status === "signed-out") {
        pendingPrompt.current = { text, images };
        composer.current?.setDraft(text, images);
        openSignIn(false);
        return false;
      }
      if (account.promptsLeft === 0) {
        setNotice({ text: "Your free prompts are used." });
        return false;
      }
    }
    setViewing(null);
    setNotice(null);
    setPane("chat");
    pinned.current = true;
    runtime.send(text, images).catch((error) => {
      composer.current?.setDraft(text, images);
      if (error instanceof PromptError && error.code === "not_signed_in") {
        setAccount({ status: "signed-out" });
        openSignIn(false);
      }
    });
    return true;
  }, [runtime, scripted, account]);

  const onSignedIn = useCallback(async () => {
    setSignIn((current) => ({ ...current, open: false }));
    await loadAccount();
    await runtime?.start(null, true);
    const draft = pendingPrompt.current;
    pendingPrompt.current = null;
    if (draft) {
      composer.current?.setDraft("", []);
      // The account state updates on the next render; send through the runtime directly.
      setViewing(null);
      setPane("chat");
      runtime?.send(draft.text, draft.images).catch(() => composer.current?.setDraft(draft.text, draft.images));
    }
  }, [loadAccount, runtime]);

  const doSignOut = useCallback(async () => {
    try { await signOut(); } catch {}
    await loadAccount();
    runtime?.newDesign();
    await runtime?.start(null, false);
  }, [loadAccount, runtime]);

  useEffect(() => { if (!active.running) setStopping(false); }, [active.running]);

  // The divider between the conversation and the preview. Its width persists.
  const resizing = useRef<{ startX: number; startWidth: number; pane: "agent" | "sidebar" } | null>(null);
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>, pane: "agent" | "sidebar") => {
    const property = pane === "agent" ? "--agent-width" : "--sidebar-width";
    const current = parseInt(getComputedStyle(document.documentElement).getPropertyValue(property)) || (pane === "agent" ? 420 : 240);
    resizing.current = { startX: event.clientX, startWidth: current, pane };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizing.current) return;
    const { pane, startWidth, startX } = resizing.current;
    const limits = pane === "agent" ? AGENT_WIDTH : SIDEBAR_WIDTH;
    const width = Math.round(Math.min(limits.max, Math.max(limits.min, startWidth + event.clientX - startX)));
    document.documentElement.style.setProperty(pane === "agent" ? "--agent-width" : "--sidebar-width", `${width}px`);
    try { localStorage.setItem(pane === "agent" ? "ta-agent-width" : "ta-sidebar-width", String(width)); } catch {}
  };

  const title = active.id === "draft" ? "Design" : state.chats.find((chat) => chat.id === active.id)?.title ?? "Design";
  const shownDesign = (viewing ? active.designs.find((design) => design.id === viewing) : null) ?? active.designs.at(-1) ?? null;
  const busy = active.running || active.pending !== null;
  const activity = active.pending ? "sending" : active.running ? (active.phase ?? "thinking") : active.watching ? "running on another device" : null;
  // Timed from the run's start, also after a reload or on another device.
  const runStartedAt = useMemo(() => {
    const start = [...active.records].reverse().find((record) => record.type === "run_start");
    return start ? active.stamps.get(Number(start.sequence)) ?? null : null;
  }, [active.records, active.stamps]);
  const activityStart = active.pending ? null : runStartedAt ?? active.startedAt;
  const quota: Quota = scripted ? { kind: "hidden" }
    : account.status === "loading" ? { kind: "hidden" }
      : account.status === "signed-out" ? { kind: "signed-out", free: freePrompts }
        : account.promptsLeft == null ? { kind: "hidden" } : { kind: "left", left: account.promptsLeft };
  const intro = active.id === "draft" && !active.pending;

  const sidebar = (
    <Sidebar
      chats={state.chats}
      activeId={active.id}
      ready={state.ready}
      now={now}
      onSelect={select}
      onNew={newDesign}
      onDelete={(id) => void runtime?.hide(id)}
      account={<Account account={account} onSignIn={() => openSignIn(false)} onSignOut={doSignOut} />}
    />
  );

  return (
    <FreePromptsContext.Provider value={freePrompts}>
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-fg">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-bg focus:px-3 focus:py-2">Skip to conversation</a>
      <div id="session-sidebar" className="relative hidden h-full shrink-0 md:block md:[html.sidebar-collapsed_&]:hidden">
        {sidebar}
        {/* The sidebar's edge: drag to resize; hover shows a round button that folds it away (Cmd/Ctrl+B). */}
        <div className="group absolute -right-px top-0 z-40 h-full w-0">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={(event) => beginResize(event, "sidebar")}
            onPointerMove={moveResize}
            onPointerUp={() => { resizing.current = null; }}
            className="absolute inset-y-0 -left-1.5 w-3 cursor-col-resize touch-none"
          />
          <button
            type="button"
            aria-label="Toggle sidebar"
            aria-keyshortcuts="Meta+B Control+B"
            onClick={() => setCollapsed(true)}
            className="absolute left-1/2 top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-content-center rounded-full border border-line-strong bg-bg text-fg opacity-0 outline-none transition-opacity hover:bg-hover focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
          >
            <svg viewBox="0 0 16 16" className="size-4 scale-90 transition-transform group-hover:scale-100" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M9.75 4.5 6.25 8l3.5 3.5" />
            </svg>
          </button>
        </div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="chats">
          <button type="button" aria-label="close chats" className="absolute inset-0 bg-black/45" onClick={() => setDrawer(false)} />
          <div className="ta-drawer relative h-full w-fit">{sidebar}</div>
        </div>
      )}

      <main id="main-content" className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        <section aria-label="conversation" className="contents min-w-0 flex-1 flex-col bg-bg lg:flex lg:w-[var(--agent-width)] lg:flex-none lg:overflow-hidden">
          {/* Below md the sidebar is a drawer, so the wordmark needs its own bar. */}
          <div className="flex h-10 shrink-0 items-center border-b border-line px-4 md:hidden">
            <Wordmark onHome={newDesign} />
          </div>

          <header className="shrink-0 border-b border-line bg-bg">
            <div className="flex h-12 items-center gap-1 px-2 md:gap-1.5 md:px-4">
              <button type="button" aria-label="open chats" aria-expanded={drawer} aria-controls="session-sidebar" onClick={() => setDrawer(true)} className={`${button.ghost} ${button.icon} md:hidden`}>
                <Menu />
              </button>
              {collapsed && (
                <div className="hidden items-center md:flex">
                  <button type="button" aria-label="show chats" onClick={() => setCollapsed(false)} className={`${button.ghost} ${button.icon}`}><PanelLeft /></button>
                  <NewDesignButton compact onNew={newDesign} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-sm font-medium tracking-[-0.01em]">{title}</h1>
              </div>
              {shownDesign && runtime && <ExportMenu design={shownDesign} load={runtime.designHtml.bind(runtime)} onNotice={(text) => setNotice({ text })} />}
              <button
                type="button"
                aria-controls="preview-pane"
                aria-expanded={pane === "preview"}
                onClick={() => setPane((value) => value === "preview" ? "chat" : "preview")}
                className={`${button.ghost} h-8 shrink-0 px-2 font-normal lg:hidden`}
              >
                {pane === "preview" ? "chat" : "preview"}
              </button>
            </div>
            {notice && (
              <div role="alert" className="flex items-center justify-between gap-3 bg-hover px-4 py-2 text-sm text-fg">
                <span>
                  {notice.text}{" "}
                  {notice.watch && (
                    <button type="button" className="underline underline-offset-2 hover:no-underline" onClick={() => { const id = notice.watch!; setNotice(null); select(id); }}>
                      view it
                    </button>
                  )}
                </span>
                <button type="button" aria-label="dismiss" onClick={() => setNotice(null)} className="shrink-0 text-muted hover:text-fg"><Close className="size-3.5" /></button>
              </div>
            )}
          </header>

          <div
            ref={thread}
            onScroll={(event) => {
              const element = event.currentTarget;
              pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
            }}
            aria-busy={busy}
            className={cn("order-1 min-h-0 flex-1 overflow-y-auto overscroll-contain lg:order-none", pane === "preview" && "hidden lg:block")}
          >
            <div className="mx-auto w-full max-w-2xl px-4 py-4 sm:px-5">
              <Transcript entries={entries} pending={active.pending} onSend={(text) => void send(text)} viewing={viewing} onView={(id) => { setViewing(id === active.designs.at(-1)?.id ? null : id); setPane("preview"); }} />
              {activity && <ActivityLine label={activity} startedAt={activityStart} />}
            </div>
          </div>

          {pane === "preview" && activity && (
            <div className="order-2 shrink-0 border-b border-line px-4 py-2 lg:hidden">
              <ActivityLine label={activity} startedAt={activityStart} />
            </div>
          )}

          <div className="order-3 shrink-0 lg:order-none">
            <Composer ref={composer} busy={busy} locked={active.watching} stopping={stopping} model={model} quota={quota} onSend={send}
              onStop={() => { setStopping(true); runtime?.stop(); }} onSignIn={() => openSignIn(false)} />
          </div>
        </section>

        <div className="relative z-30 hidden w-0 lg:block">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize conversation and preview"
            onPointerDown={(event) => beginResize(event, "agent")}
            onPointerMove={moveResize}
            onPointerUp={() => { resizing.current = null; }}
            className="absolute inset-y-0 -left-2 w-4 cursor-col-resize touch-none"
          />
        </div>

        <div className={cn("order-1 flex min-h-0 min-w-0 flex-1 lg:order-none", pane === "chat" && "hidden lg:flex")}>
          <PreviewPane designs={active.designs} load={runtime ? runtime.designHtml.bind(runtime) : null} viewing={viewing} draft={active.draft} intro={intro} onLatest={() => setViewing(null)} />
        </div>
      </main>

      <SignInDialog
        open={signIn.open}
        startAtFlow={signIn.atFlow}
        freePrompts={freePrompts}
        onOpenChange={(open) => { setSignIn((current) => ({ ...current, open })); if (!open) composer.current?.focus(); }}
        onSignedIn={() => void onSignedIn()}
      />
    </div>
    </FreePromptsContext.Provider>
  );
}
