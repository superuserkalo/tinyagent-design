// The agent loop in the tab. Each chat is a TinyAgent Session whose journal lives on
// the server (lib/client/server-storage.ts), keyed by the radian.sh account, so it
// follows the user to every device. One tab runs a chat at a time: it holds the
// chat's lease while a run is active; any other tab or device watches by polling.
// A run that a reload cut short continues in the same tab (it keeps its lease owner
// id in sessionStorage); elsewhere it continues only once the lease has lapsed.
import {
  ChatCompletionsProvider,
  Session,
  checkStorage,
  type AgentEvent,
  type ContentPart,
  type Item,
  type Provider,
} from "tiny-agent-sdk/browser";
import { createDesignAgent } from "../agent.ts";
import { compactRequest } from "../request-budget.ts";
import { publishDesignTool } from "../tools.ts";
import { api, apiHeaders, errorMessage } from "./api.ts";
import { partialJsonString, watchToolArguments } from "./draft.ts";
import type { AttachedImage } from "./images.ts";
import { scriptedProvider } from "./scripted.ts";
import { ServerStorage } from "./server-storage.ts";

const GRANT_HEADER = "x-tinyagent-grant";
/** Lets the server find a model call this chat already started, to replay it after a reload. */
const CHAT_HEADER = "x-tinyagent-chat";
/** The server picks the real model; the journal records this name. */
const MODEL = "gateway";
const HEARTBEAT_MS = 7_000;
const WATCH_MS = 1_500;
const IDLE_WATCH_MS = 3_000;
const CHATS_MS = 15_000;

export type Phase = "sending" | "thinking" | "generating" | "resuming";

export interface ChatSummary {
  id: string;
  title: string | null;
  updatedAt: number;
  /** A tab somewhere holds the chat's lease. */
  busy: boolean;
}

export interface DesignMeta {
  id: string;
  title: string;
  seq: number;
}

export interface ActiveView {
  /** "draft" until the first prompt creates the chat. */
  id: string;
  records: Item[];
  stamps: Map<number, number>;
  designs: DesignMeta[];
  running: boolean;
  liveText: string;
  /** Text of the turn a reload interrupted, kept in this tab only, shown until the resumed turn streams. */
  partialText: string;
  phase: Phase | null;
  startedAt: number | null;
  /** The page as the model writes it, before publish_design runs. */
  draft: string | null;
  /** A prompt waiting for its grant. */
  pending: { text: string; images: AttachedImage[] } | null;
  /** Another tab or device is running this chat; this one shows its progress. */
  watching: boolean;
  /** The journal sequence after which this run was resumed in this tab. */
  resumedAt: number | null;
}

export interface Notice {
  text: string;
  /** Offer to show the chat as it runs elsewhere. */
  watch?: string;
}

export interface RuntimeState {
  ready: boolean;
  chats: ChatSummary[];
  active: ActiveView;
  notice: Notice | null;
}

export class PromptError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface Live {
  running: boolean;
  text: string;
  phase: Phase | null;
  startedAt: number | null;
  draft: string | null;
  controller: AbortController | null;
  resumedAt: number | null;
}

interface ChatRow {
  id: string;
  title: string;
  updatedAt: number;
  grant: { id: string; expiresAt: number } | null;
  lease: { owner: string; until: number } | null;
}

const EMPTY: ActiveView = {
  id: "draft", records: [], stamps: new Map(), designs: [], running: false, liveText: "", partialText: "", phase: null,
  startedAt: null, draft: null, pending: null, watching: false, resumedAt: null,
};

export interface RuntimeOptions {
  /** Development only: the scripted model, no gateway. */
  scripted: boolean;
  /** Development only: publish_design waits a few seconds after storing, so a reload can land mid-tool. */
  slowTool: boolean;
  onPromptsLeft?: (left: number) => void;
  onRunEnd?: () => void;
}

function tabOwner(): string {
  // Kept for the life of the tab, across reloads, so a reloaded tab can take its own lease back at once.
  try {
    const saved = sessionStorage.getItem("ta-tab");
    if (saved) return saved;
    const owner = `tab-${crypto.randomUUID()}`;
    sessionStorage.setItem("ta-tab", owner);
    return owner;
  } catch {
    return `tab-${crypto.randomUUID()}`;
  }
}

function newSessionId(): string {
  return `s_${Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** UI-only memory of a turn's streamed text, so a reload can show it while the turn is redone. */
const partial = {
  key: (id: string) => `ta-partial:${id}`,
  save(id: string, cursor: number, text: string) {
    try { sessionStorage.setItem(partial.key(id), JSON.stringify({ cursor, text })); } catch {}
  },
  take(id: string, cursor: number): string {
    try {
      const saved = JSON.parse(sessionStorage.getItem(partial.key(id)) ?? "null") as { cursor: number; text: string } | null;
      return saved && saved.cursor === cursor ? saved.text : "";
    } catch {
      return "";
    }
  },
  clear(id: string) {
    try { sessionStorage.removeItem(partial.key(id)); } catch {}
  },
};

export class DesignRuntime {
  private readonly options: RuntimeOptions;
  private readonly owner = tabOwner();
  private readonly storage: ServerStorage;
  private readonly sessions = new Map<string, Session>();
  private readonly grants = new Map<string, string>();
  private readonly live = new Map<string, Live>();
  private readonly rows = new Map<string, ChatRow>();
  private readonly html = new Map<string, Promise<string>>();
  private readonly listeners = new Set<() => void>();
  private state: RuntimeState = { ready: false, chats: [], active: EMPTY, notice: null };
  private frame = 0;
  private watcher: { id: string; timer: ReturnType<typeof setTimeout> | null } | null = null;
  private chatsTimer: ReturnType<typeof setInterval> | null = null;
  private signedIn = false;

  constructor(options: RuntimeOptions) {
    if (options.scripted && process.env.NODE_ENV !== "development") throw new Error("the scripted model exists only in development");
    this.options = options;
    this.storage = new ServerStorage(this.owner);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  snapshot = () => this.state;

  private set(next: Partial<RuntimeState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  private patchActive(id: string, next: Partial<ActiveView>) {
    if (this.state.active.id === id) this.set({ active: { ...this.state.active, ...next } });
  }

  /** Text deltas arrive fast: publish at most once a frame. */
  private soon(work: () => void) {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; work(); });
  }

  /** Called once the account is known. Signed out, there are no chats to show. */
  async start(initialId: string | null, signedIn: boolean): Promise<void> {
    this.signedIn = signedIn;
    if (!signedIn) {
      this.set({ ready: true, chats: [] });
      return;
    }
    await this.refreshChats().catch(() => {});
    this.set({ ready: true });
    this.chatsTimer ??= setInterval(() => void this.refreshChats().catch(() => {}), CHATS_MS);
    window.addEventListener("focus", () => void this.refreshChats().catch(() => {}));
    if (initialId && this.rows.has(initialId)) await this.select(initialId);
  }

  /** The sidebar, from the server: the same list on every device. */
  async refreshChats(): Promise<void> {
    if (!this.signedIn) return;
    const response = await api<{ chats: ChatRow[]; now: number }>("/api/chats");
    if (!response.ok) return;
    const skew = response.body.now - Date.now();
    this.rows.clear();
    for (const row of response.body.chats) this.rows.set(row.id, row);
    this.set({
      chats: response.body.chats.map((row) => ({
        id: row.id, title: row.title || null, updatedAt: row.updatedAt,
        busy: (this.live.get(row.id)?.running ?? false) || Boolean(row.lease && row.lease.until > Date.now() + skew),
      })),
    });
  }

  private agentFor(sessionId: string) {
    const tool = publishDesignTool(async (design, signal) => {
      const response = await api(`/api/designs/${encodeURIComponent(design.executionId)}`, { method: "PUT", body: { title: design.title, html: design.html }, signal });
      if (!response.ok) throw new Error(errorMessage(response.body, "the design could not be saved"));
      this.html.set(design.executionId, Promise.resolve(design.html));
      const row = this.rows.get(sessionId);
      if (!row?.title || row.title === this.firstTitle.get(sessionId)) {
        await api(`/api/chats/${encodeURIComponent(sessionId)}`, { method: "PATCH", body: { title: design.title } }).catch(() => {});
        if (row) row.title = design.title;
        this.firstTitle.delete(sessionId);
      }
      if (this.options.scripted && this.options.slowTool) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 4000);
          signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
        });
      }
      const designs = await this.loadDesigns(sessionId);
      return designs.findIndex((row) => row.id === design.executionId) + 1;
    });
    return createDesignAgent({ model: MODEL, provider: this.providerFor(sessionId), tools: [tool] });
  }

  private readonly firstTitle = new Map<string, string>();

  private providerFor(sessionId: string): Provider {
    if (this.options.scripted) return scriptedProvider(this.options.slowTool ? 4000 : 1500);
    return new ChatCompletionsProvider({
      baseUrl: `${window.location.origin}/api/model/v1`,
      apiKey: "", // No key in the page: the server holds the gateway credential.
      fetch: async (input, init) => {
        const headers = apiHeaders(init?.headers);
        const grant = this.grants.get(sessionId);
        if (grant) headers.set(GRANT_HEADER, grant);
        headers.set(CHAT_HEADER, sessionId);
        // Older pages and images are dropped from the request; the journal keeps them.
        let body = init?.body;
        if (typeof body === "string") {
          try { body = JSON.stringify(compactRequest(JSON.parse(body))); } catch {}
        }
        const response = await fetch(input, { ...init, body, headers, credentials: "same-origin" });
        if (!response.ok || !response.body) return response;
        const [forSdk, forDraft] = response.body.tee();
        void watchToolArguments(forDraft, (args) => this.onDraft(sessionId, args));
        return new Response(forSdk, { status: response.status, statusText: response.statusText, headers: response.headers });
      },
    });
  }

  private onDraft(sessionId: string, args: string) {
    const html = partialJsonString(args, "html");
    const live = this.live.get(sessionId);
    if (!live || html === null) return;
    live.draft = html;
    live.phase = "generating";
    this.soon(() => this.refreshLive(sessionId));
  }

  private async loadDesigns(id: string): Promise<DesignMeta[]> {
    const response = await api<{ designs: DesignMeta[] }>(`/api/chats/${encodeURIComponent(id)}/designs`);
    const designs = response.ok ? response.body.designs : [];
    this.patchActive(id, { designs });
    return designs;
  }

  /** A design's HTML, fetched once. */
  designHtml(id: string): Promise<string> {
    let html = this.html.get(id);
    if (!html) {
      html = api<{ html: string }>(`/api/designs/${encodeURIComponent(id)}`).then((response) => {
        if (!response.ok) throw new Error("the design could not be loaded");
        return response.body.html;
      });
      html.catch(() => this.html.delete(id));
      this.html.set(id, html);
    }
    return html;
  }

  private async open(id: string, fresh = false): Promise<Session> {
    const existing = this.sessions.get(id);
    if (existing && !fresh) return existing;
    const session = new Session(this.agentFor(id), { storage: this.storage, sessionId: id, resume: true });
    await session.ready;
    this.sessions.set(id, session);
    return session;
  }

  private viewOf(id: string, session: Session | null, records: Item[], designs: DesignMeta[], watching: boolean): ActiveView {
    const live = this.live.get(id);
    const cursor = records.length;
    return {
      id, records, stamps: new Map(this.storage.stamps(id)), designs,
      running: live?.running ?? false, liveText: live?.text ?? "",
      partialText: live?.text ? "" : (session?.resumable || watching ? partial.take(id, cursor) : ""),
      phase: live?.phase ?? (watching ? "thinking" : null), startedAt: live?.startedAt ?? null,
      draft: live?.draft ?? null, pending: null, watching, resumedAt: live?.resumedAt ?? null,
    };
  }

  async select(id: string): Promise<void> {
    if (id === "draft") return this.newDesign();
    this.stopWatching();
    this.set({ notice: null });
    let session: Session;
    try {
      // A chat this tab is not running is read fresh: another device may have moved it on.
      session = await this.open(id, !this.live.get(id)?.running);
    } catch (error) {
      this.set({ notice: { text: error instanceof Error ? error.message : "This chat could not be opened." } });
      return;
    }
    const designs = await this.loadDesigns(id).catch(() => []);
    const row = await this.chatRow(id);
    void this.refreshChats().catch(() => {});
    const running = this.live.get(id)?.running ?? false;
    const elsewhere = !running && this.heldElsewhere(row);
    this.set({ active: this.viewOf(id, session, session.records, designs, elsewhere) });
    if (running) return;
    if (!elsewhere && session.resumable) await this.resume(id, session, row);
    // Not running here: follow it, in case another tab or device runs it.
    if (!this.live.get(id)?.running) this.watch(id);
  }

  private async chatRow(id: string): Promise<ChatRow | null> {
    const response = await api<{ chat: ChatRow; now: number }>(`/api/chats/${encodeURIComponent(id)}`);
    if (!response.ok) return null;
    const skew = response.body.now - Date.now();
    const row = { ...response.body.chat, lease: response.body.chat.lease ? { ...response.body.chat.lease, until: response.body.chat.lease.until - skew } : null };
    this.rows.set(id, row);
    return row;
  }

  private heldElsewhere(row: ChatRow | null): boolean {
    return Boolean(row?.lease && row.lease.owner !== this.owner && row.lease.until > Date.now());
  }

  newDesign(): void {
    this.stopWatching();
    this.set({ active: EMPTY, notice: null });
  }

  /**
   * Follow the open chat while this tab is not running it: new records from another
   * tab or device appear here, and while one holds the lease the composer is locked.
   */
  private watch(id: string) {
    this.stopWatching();
    const watcher = { id, timer: null as ReturnType<typeof setTimeout> | null };
    this.watcher = watcher;
    const tick = async () => {
      if (this.watcher !== watcher || this.state.active.id !== id || this.live.get(id)?.running) return;
      try {
        const known = this.state.active.records.length;
        const response = await api<{ records: { seq: number; at: number; record: Item }[]; next: number | null; lease: ChatRow["lease"]; now: number }>(
          `/api/chats/${encodeURIComponent(id)}/records?after=${known}`);
        if (this.watcher !== watcher || this.state.active.id !== id || this.live.get(id)?.running) return;
        if (response.ok) {
          const added = response.body.records.map((row) => ({ ...row.record, sequence: row.seq })) as Item[];
          const stamps = this.storage.stamps(id);
          for (const row of response.body.records) stamps.set(row.seq, row.at);
          if (added.length) {
            this.patchActive(id, { records: [...this.state.active.records, ...added], stamps: new Map(stamps), partialText: "" });
            if (added.some((record) => record.type === "tool_result")) void this.loadDesigns(id);
          }
          const lease = response.body.lease;
          const skew = response.body.now - Date.now();
          const elsewhere = Boolean(lease && lease.owner !== this.owner && lease.until - skew > Date.now());
          if (elsewhere && !this.state.active.watching) {
            this.patchActive(id, { watching: true, phase: "thinking" });
            void this.refreshChats().catch(() => {});
          } else if (!elsewhere && this.state.active.watching) {
            // The other tab finished, or went away: open the chat properly (and resume it, if a run was cut short).
            this.stopWatching();
            await this.select(id);
            return;
          }
        }
      } catch {}
      watcher.timer = setTimeout(() => void tick(), this.state.active.watching ? WATCH_MS : IDLE_WATCH_MS);
    };
    watcher.timer = setTimeout(() => void tick(), this.state.active.watching ? WATCH_MS : IDLE_WATCH_MS);
  }

  private stopWatching() {
    if (this.watcher?.timer) clearTimeout(this.watcher.timer);
    this.watcher = null;
  }

  private async lease(id: string, grant?: { id: string; expiresAt: number }): Promise<boolean> {
    const response = await api(`/api/chats/${encodeURIComponent(id)}/lease`, { body: { owner: this.owner, ...(grant ? { grant } : {}) } });
    return response.ok;
  }

  private release(id: string) {
    void api(`/api/chats/${encodeURIComponent(id)}/lease`, { body: { owner: this.owner, release: true } }).catch(() => {});
  }

  private refreshLive(id: string) {
    const live = this.live.get(id);
    this.patchActive(id, { liveText: live?.text ?? "", phase: live?.phase ?? null, draft: live?.draft ?? null, running: live?.running ?? false });
  }

  private async refresh(id: string) {
    const session = this.sessions.get(id);
    if (!session || this.state.active.id !== id) return;
    const live = this.live.get(id);
    this.patchActive(id, {
      records: session.records, stamps: new Map(this.storage.stamps(id)), running: live?.running ?? false,
      phase: live?.phase ?? null, resumedAt: live?.resumedAt ?? null, watching: false,
    });
  }

  private handler(id: string, session: Session) {
    let saved = 0;
    return (event: AgentEvent) => {
      const live = this.live.get(id);
      if (!live) return;
      switch (event.type) {
        case "agent_start":
          live.running = true;
          live.phase = live.resumedAt !== null ? "resuming" : "thinking";
          void this.refresh(id);
          break;
        case "text_delta":
          live.text += event.delta;
          live.phase = "generating";
          this.patchActive(id, { partialText: "" });
          // Kept in this tab, so a reload mid-turn can show what had arrived.
          if (Date.now() - saved > 400) { saved = Date.now(); partial.save(id, session.cursor, live.text); }
          this.soon(() => this.refreshLive(id));
          break;
        case "tool_execution_start":
          live.text = "";
          live.phase = "thinking";
          partial.clear(id);
          void this.refresh(id);
          break;
        case "tool_execution_end":
          live.draft = null;
          live.phase = "thinking";
          void this.refresh(id);
          void this.loadDesigns(id);
          break;
        case "agent_end":
          break;
      }
    };
  }

  /** Run `work` holding the chat's lease, renewing it until the run ends. */
  private async drive(id: string, session: Session, startedAt: number, resumedAt: number | null, work: (signal: AbortSignal, onEvent: (event: AgentEvent) => void) => Promise<unknown>) {
    const controller = new AbortController();
    const live: Live = { running: true, text: "", phase: resumedAt !== null ? "resuming" : "thinking", startedAt, draft: null, controller, resumedAt };
    this.live.set(id, live);
    if (this.watcher?.id === id) this.stopWatching();
    const heartbeat = setInterval(() => {
      void this.lease(id).then((held) => {
        // Another tab took the chat over (our lease had lapsed): stop spending on it.
        if (!held) controller.abort();
      });
    }, HEARTBEAT_MS);
    void this.refresh(id);
    void this.refreshChats().catch(() => {});
    let fenced = false;
    try {
      await work(controller.signal, this.handler(id, session));
    } catch (error) {
      const code = (error as { code?: string })?.code;
      fenced = code === "session_fenced" || (error instanceof Error && /another tab|another device|fenced/i.test(error.message));
    } finally {
      clearInterval(heartbeat);
      live.running = false;
      live.phase = null;
      live.draft = null;
      live.text = "";
      live.controller = null;
      partial.clear(id);
      this.grants.delete(id);
      if (!fenced) this.release(id);
      // The session object is spent after a fenced write; the next look reads the journal again.
      if (fenced) this.sessions.delete(id);
      if (fenced) this.set({ notice: { text: "This chat is running on another device.", watch: id } });
      if (this.sessions.has(id)) await this.refresh(id);
      if (this.state.active.id === id && !fenced) this.watch(id);
      void this.refreshChats().catch(() => {});
      void this.loadDesigns(id).catch(() => {});
      this.options.onRunEnd?.();
    }
  }

  private runStart(session: Session): number {
    const records = session.records;
    const start = [...records].reverse().find((record) => record.type === "run_start");
    return (start && this.storage.stamps(session.id).get(Number(start.sequence))) ?? Date.now();
  }

  private async resume(id: string, session: Session, row: ChatRow | null): Promise<void> {
    const grant = row?.grant;
    if (!this.options.scripted && (!grant || grant.expiresAt <= Date.now())) {
      // Without a live grant the model route would refuse every request: set the run aside.
      if (await this.lease(id)) {
        await session.abandon("The prompt's grant expired before the run could continue.").catch(() => {});
        this.release(id);
      }
      await this.refresh(id);
      return;
    }
    if (!(await this.lease(id))) {
      this.patchActive(id, { watching: true });
      return this.watch(id);
    }
    if (grant) this.grants.set(id, grant.id);
    await this.drive(id, session, this.runStart(session), session.cursor, (signal, onEvent) => session.resume({ signal, onEvent }));
  }

  private async requestGrant(): Promise<{ id: string; expiresAt: number }> {
    const response = await api<{ grant?: { id: string; expiresAt: number }; remaining?: number }>("/api/prompts", { body: {} });
    if (typeof response.body?.remaining === "number") this.options.onPromptsLeft?.(response.body.remaining);
    if (!response.ok || !response.body?.grant) {
      throw new PromptError((response.body as { error?: { code?: string } })?.error?.code ?? "error", errorMessage(response.body, "The prompt could not be sent."));
    }
    return response.body.grant;
  }

  /** Send a prompt in the chat on screen, or start a new chat with it. */
  async send(text: string, images: AttachedImage[] = []): Promise<void> {
    const prompt = text.trim();
    if (!prompt && images.length === 0) return;
    const activeId = this.state.active.id;
    if (this.state.active.watching) throw new PromptError("busy_elsewhere", "This chat is running on another device.");
    if (activeId !== "draft" && this.live.get(activeId)?.running) return;
    this.stopWatching();
    this.set({ active: { ...this.state.active, pending: { text: prompt, images }, phase: "sending" }, notice: null });
    const fail = (error: unknown): never => {
      this.set({ active: { ...this.state.active, pending: null, phase: null }, notice: { text: error instanceof Error ? error.message : String(error) } });
      throw error;
    };

    const id = activeId === "draft" ? newSessionId() : activeId;
    // Take the chat first, so a second device cannot start on it at the same time.
    const claimed = activeId === "draft"
      ? await api("/api/chats", { body: { id, owner: this.owner, title: prompt.slice(0, 80) || "image prompt" } }).then((response) => response.ok)
      : await this.lease(id);
    if (!claimed) {
      if (activeId !== "draft") {
        this.set({ active: { ...this.state.active, pending: null, phase: null } });
        await this.select(id);
      }
      return fail(new PromptError("busy_elsewhere", "This chat is running on another device."));
    }

    let grant: { id: string; expiresAt: number } | undefined;
    if (!this.options.scripted) {
      try {
        grant = await this.requestGrant();
      } catch (error) {
        this.release(id);
        return fail(error);
      }
      await this.lease(id, grant);
      this.grants.set(id, grant.id);
    }

    let session: Session;
    try {
      if (activeId === "draft") {
        this.firstTitle.set(id, prompt.slice(0, 80) || "image prompt");
        session = new Session(this.agentFor(id), { storage: this.storage, sessionId: id });
        await session.ready;
        this.sessions.set(id, session);
        const url = new URL(window.location.href);
        url.searchParams.set("s", id);
        window.history.replaceState(window.history.state, "", url);
      } else {
        session = await this.open(id, true);
        if (session.resumable) await session.abandon("A new prompt was sent.").catch(() => {});
      }
    } catch (error) {
      this.release(id);
      return fail(error);
    }
    this.set({ active: this.viewOf(id, session, session.records, this.state.active.designs, false) });
    const content: string | ContentPart[] = images.length
      ? [{ type: "text", text: prompt || "Use these images." }, ...images.map((image) => ({ type: "image" as const, mediaType: image.mediaType, data: image.data }))]
      : prompt;
    await this.drive(id, session, Date.now(), null, (signal, onEvent) => session.run(content, { signal, onEvent }));
  }

  stop(): void {
    const id = this.state.active.id;
    this.live.get(id)?.controller?.abort();
    // The model call runs on the server until told otherwise; closing the tab does not stop it.
    this.stopOnServer(id);
  }

  private stopOnServer(id: string) {
    if (!this.options.scripted) void api(`/api/chats/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} }).catch(() => {});
  }

  async hide(id: string): Promise<void> {
    this.live.get(id)?.controller?.abort();
    this.stopOnServer(id);
    await api(`/api/chats/${encodeURIComponent(id)}`, { method: "PATCH", body: { hidden: true } }).catch(() => {});
    if (this.state.active.id === id) this.newDesign();
    await this.refreshChats().catch(() => {});
  }

  /** Development checks, run from the browser console or the e2e script. */
  debug() {
    return {
      /** The SDK's storage contract against the server-backed Storage. Run it as a separate dev user: it leaves two chats. */
      checkStorage: async () => {
        await checkStorage(new ServerStorage(`tab-check-${crypto.randomUUID()}`));
        return "checkStorage passed on the server-backed storage";
      },
      designs: (id: string) => api<{ designs: DesignMeta[] }>(`/api/chats/${encodeURIComponent(id)}/designs`).then((response) => response.body.designs),
      records: (id: string) => this.state.active.id === id ? this.state.active.records : this.sessions.get(id)?.records ?? [],
      owner: this.owner,
    };
  }
}
