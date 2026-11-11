// The agent loop in the tab. Each chat is a TinyAgent Session journaled in
// IndexedDB; this object opens them, runs prompts, resumes runs a reload cut
// short, and publishes a snapshot the React tree renders.
import {
  ChatCompletionsProvider,
  Session,
  checkStorage,
  type AgentEvent,
  type Item,
  type Provider,
} from "tiny-agent-sdk/browser";
import { createDesignAgent } from "../agent.ts";
import { JournalStorage } from "../storage.ts";
import { publishDesignTool } from "../tools.ts";
import { errorText, firstPrompt } from "../transcript.ts";
import { partialJsonString, watchToolArguments } from "./draft.ts";
import { IdbJournalBackend, SiteDatabase, openDatabase, type ChatMeta, type StoredDesign } from "./idb.ts";
import { scriptedProvider } from "./scripted.ts";

const GRANT_HEADER = "x-tinyagent-grant";
/** The server picks the real model; the journal records this name. */
const MODEL = "gateway";

export type Phase = "sending" | "thinking" | "generating";

export interface ChatSummary {
  id: string;
  title: string | null;
  updatedAt: number;
  busy: boolean;
}

export interface ActiveView {
  /** "draft" until the first prompt creates the session. */
  id: string;
  records: Item[];
  stamps: Map<number, number>;
  designs: StoredDesign[];
  running: boolean;
  liveText: string;
  phase: Phase | null;
  startedAt: number | null;
  /** The page as the model writes it, before publish_design runs. */
  draft: string | null;
  /** A prompt waiting for its grant. */
  pending: string | null;
}

export interface RuntimeState {
  ready: boolean;
  chats: ChatSummary[];
  active: ActiveView;
  notice: string | null;
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
}

const EMPTY: ActiveView = {
  id: "draft", records: [], stamps: new Map(), designs: [], running: false, liveText: "", phase: null,
  startedAt: null, draft: null, pending: null,
};

export interface RuntimeOptions {
  /** Development only: the scripted model, no auth, no gateway. */
  scripted: boolean;
  /** Development only: publish_design waits a few seconds after storing, so a reload can land mid-tool. */
  slowTool: boolean;
  onPromptsLeft?: (left: number) => void;
  onRunEnd?: () => void;
}

export class DesignRuntime {
  private readonly options: RuntimeOptions;
  private db!: SiteDatabase;
  private storage!: JournalStorage;
  private readonly sessions = new Map<string, Session>();
  private readonly grants = new Map<string, string>();
  private readonly live = new Map<string, Live>();
  private readonly meta = new Map<string, ChatMeta>();
  private readonly listeners = new Set<() => void>();
  private state: RuntimeState = { ready: false, chats: [], active: EMPTY, notice: null };
  private frame = 0;

  constructor(options: RuntimeOptions) {
    if (options.scripted && process.env.NODE_ENV !== "development") throw new Error("the scripted model exists only in development");
    this.options = options;
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

  /** Text deltas arrive fast: publish at most once a frame. */
  private soon(work: () => void) {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; work(); });
  }

  async start(initialId: string | null): Promise<void> {
    const database = openDatabase();
    this.db = new SiteDatabase(database);
    this.storage = new JournalStorage(new IdbJournalBackend(database));
    for (const chat of await this.db.chats()) this.meta.set(chat.id, chat);
    const ids = await this.storage.list();
    // Open every chat's journal: a run that a reload cut short continues now.
    const opened = await Promise.all(ids.map(async (id) => {
      try { return await this.open(id); } catch { return null; }
    }));
    this.set({ ready: true, chats: this.summaries() });
    const wanted = initialId && ids.includes(initialId) ? initialId : null;
    if (wanted) await this.select(wanted);
    for (const session of opened) if (session?.resumable) void this.resume(session);
  }

  private async open(id: string): Promise<Session> {
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const session = new Session(this.agentFor(id), { storage: this.storage, sessionId: id, resume: true });
    await session.ready;
    this.sessions.set(id, session);
    if (!this.meta.has(id)) {
      const now = Date.now();
      this.meta.set(id, { id, title: firstPrompt(session.records)?.slice(0, 80) ?? "new chat", createdAt: now, updatedAt: now });
    }
    return session;
  }

  private agentFor(sessionId: string) {
    const tool = publishDesignTool(async (design, signal) => {
      const id = design.executionId.slice(0, design.executionId.lastIndexOf(":"));
      await this.db.putDesign({ id: design.executionId, sessionId: id, title: design.title, html: design.html, createdAt: Date.now() });
      const meta = this.meta.get(id);
      if (meta && !meta.designTitled) await this.saveMeta({ ...meta, title: design.title, designTitled: true });
      if (this.options.scripted && this.options.slowTool) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 4000);
          signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
        });
      }
      const designs = await this.db.designs(id);
      return designs.findIndex((row) => row.id === design.executionId) + 1;
    });
    return createDesignAgent({ model: MODEL, provider: this.providerFor(sessionId), tools: [tool] });
  }

  private providerFor(sessionId: string): Provider {
    if (this.options.scripted) return scriptedProvider();
    return new ChatCompletionsProvider({
      baseUrl: `${window.location.origin}/api/model/v1`,
      apiKey: "", // No key in the page: the server holds the gateway credential.
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        const grant = this.grants.get(sessionId);
        if (grant) headers.set(GRANT_HEADER, grant);
        const response = await fetch(input, { ...init, headers, credentials: "same-origin" });
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

  private summaries(): ChatSummary[] {
    return [...this.sessions.keys()]
      .map((id) => this.meta.get(id))
      .filter((meta): meta is ChatMeta => Boolean(meta) && !meta!.hidden)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((meta) => ({ id: meta.id, title: meta.title, updatedAt: meta.updatedAt, busy: this.live.get(meta.id)?.running ?? false }));
  }

  private async saveMeta(meta: ChatMeta) {
    this.meta.set(meta.id, meta);
    await this.db.putChat(meta);
  }

  async select(id: string): Promise<void> {
    if (id === "draft") return this.newDesign();
    const session = await this.open(id);
    const [stamps, designs] = await Promise.all([this.storage.stamps(id), this.db.designs(id)]);
    this.set({ active: this.viewOf(id, session, stamps, designs), notice: null });
  }

  newDesign(): void {
    this.set({ active: EMPTY, notice: null });
  }

  private viewOf(id: string, session: Session, stamps: Map<number, number>, designs: StoredDesign[]): ActiveView {
    const live = this.live.get(id);
    return {
      id, records: session.records, stamps, designs, running: live?.running ?? false, liveText: live?.text ?? "",
      phase: live?.phase ?? null, startedAt: live?.startedAt ?? null, draft: live?.draft ?? null, pending: null,
    };
  }

  /** Re-read one chat from its journal and IndexedDB, if it is the one on screen. */
  private async refresh(id: string): Promise<void> {
    this.set({ chats: this.summaries() });
    if (this.state.active.id !== id) return;
    const session = this.sessions.get(id);
    if (!session) return;
    const [stamps, designs] = await Promise.all([this.storage.stamps(id), this.db.designs(id)]);
    if (this.state.active.id === id) this.set({ active: this.viewOf(id, session, stamps, designs) });
  }

  private refreshLive(id: string) {
    if (this.state.active.id !== id) return;
    const live = this.live.get(id);
    this.set({ active: { ...this.state.active, liveText: live?.text ?? "", phase: live?.phase ?? null, draft: live?.draft ?? null, running: live?.running ?? false } });
  }

  private handler(id: string) {
    return (event: AgentEvent) => {
      const live = this.live.get(id);
      if (!live) return;
      switch (event.type) {
        case "agent_start":
          live.running = true;
          live.phase = "thinking";
          void this.refresh(id);
          break;
        case "text_delta":
          live.text += event.delta;
          live.phase = "generating";
          this.soon(() => this.refreshLive(id));
          break;
        case "tool_execution_start":
          live.text = "";
          live.phase = "thinking";
          void this.refresh(id);
          break;
        case "tool_execution_end":
          live.draft = null;
          live.phase = "thinking";
          void this.refresh(id);
          break;
        case "agent_end":
          break;
      }
    };
  }

  private async drive(id: string, work: (signal: AbortSignal, onEvent: (event: AgentEvent) => void) => Promise<unknown>) {
    const controller = new AbortController();
    const live: Live = { running: true, text: "", phase: "thinking", startedAt: Date.now(), draft: null, controller };
    this.live.set(id, live);
    void this.refresh(id);
    try {
      await work(controller.signal, this.handler(id));
    } catch {
      // A failed or stopped run is in the journal; the transcript shows it.
    } finally {
      live.running = false;
      live.phase = null;
      live.draft = null;
      live.text = "";
      live.controller = null;
      const meta = this.meta.get(id);
      if (meta) await this.saveMeta({ ...meta, updatedAt: Date.now(), grant: undefined }).catch(() => {});
      await this.refresh(id);
      this.options.onRunEnd?.();
    }
  }

  private async resume(session: Session): Promise<void> {
    const id = session.id;
    const grant = this.meta.get(id)?.grant;
    if (!this.options.scripted) {
      if (!grant || grant.expiresAt <= Date.now()) {
        // Without a live grant the model route would refuse every request: set the run aside.
        await session.abandon("The prompt's grant expired before the run could continue.").catch(() => {});
        await this.refresh(id);
        return;
      }
      this.grants.set(id, grant.id);
    }
    await this.drive(id, (signal, onEvent) => session.resume({ signal, onEvent }));
  }

  private async requestGrant(): Promise<{ id: string; expiresAt: number }> {
    const response = await fetch("/api/prompts", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" } });
    const body = await response.json().catch(() => null) as { grant?: { id: string; expiresAt: number }; remaining?: number; error?: { code: string; message: string } } | null;
    if (typeof body?.remaining === "number") this.options.onPromptsLeft?.(body.remaining);
    if (!response.ok || !body?.grant) throw new PromptError(body?.error?.code ?? "error", body?.error?.message ?? "The prompt could not be sent.");
    return body.grant;
  }

  /** Send a prompt in the chat on screen, or start a new chat with it. */
  async send(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt) return;
    const activeId = this.state.active.id;
    if (activeId !== "draft" && this.live.get(activeId)?.running) return;
    this.set({ active: { ...this.state.active, pending: prompt, phase: "sending" }, notice: null });

    let grant: { id: string; expiresAt: number } | undefined;
    if (!this.options.scripted) {
      try {
        grant = await this.requestGrant();
      } catch (error) {
        this.set({ active: { ...this.state.active, pending: null, phase: null }, notice: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }

    let session: Session;
    if (activeId === "draft") {
      const id = `s_${Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      session = new Session(this.agentFor(id), { storage: this.storage, sessionId: id });
      await session.ready;
      this.sessions.set(session.id, session);
      const now = Date.now();
      await this.saveMeta({ id: session.id, title: prompt.slice(0, 80), createdAt: now, updatedAt: now, grant });
      const url = new URL(window.location.href);
      url.searchParams.set("s", session.id);
      window.history.replaceState(window.history.state, "", url);
    } else {
      session = await this.open(activeId);
      const meta = this.meta.get(activeId)!;
      await this.saveMeta({ ...meta, updatedAt: Date.now(), grant });
      if (session.resumable) await session.abandon("A new prompt was sent.").catch(() => {});
    }
    if (grant) this.grants.set(session.id, grant.id);
    const id = session.id;
    const [stamps, designs] = await Promise.all([this.storage.stamps(id), this.db.designs(id)]);
    this.set({ active: this.viewOf(id, session, stamps, designs) });
    await this.drive(id, (signal, onEvent) => session.run(prompt, { signal, onEvent }));
  }

  stop(): void {
    this.live.get(this.state.active.id)?.controller?.abort();
  }

  async hide(id: string): Promise<void> {
    const meta = this.meta.get(id);
    if (!meta) return;
    this.live.get(id)?.controller?.abort();
    await this.saveMeta({ ...meta, hidden: true });
    if (this.state.active.id === id) this.newDesign();
    this.set({ chats: this.summaries() });
  }

  /** Development checks, run from the browser console or the e2e script. */
  debug() {
    return {
      checkStorage: async () => {
        const database = openDatabase(`tinyagent-design-check-${Date.now()}`);
        await checkStorage(new JournalStorage(new IdbJournalBackend(database)));
        return "checkStorage passed on IndexedDB";
      },
      designs: (id: string) => this.db.designs(id),
      records: (id: string) => this.sessions.get(id)?.records ?? [],
    };
  }
}

export { errorText };
