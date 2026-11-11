import type { Agent } from "./agent.ts";
import { type Storage } from "./storage.ts";
import { type Item, type RunOptions, type RunResult, type AgentEvent, type Usage, type PendingPause, type Content } from "./types.ts";
export declare class RecoveryRequiredError extends Error {
}
/** A storage error or a fenced append stopped this Session object. Open the session again. */
export declare class SessionFailedError extends Error {
    readonly code = "session_failed";
    constructor();
}
/** `resume_required`: finish the interrupted run first. `nothing_to_resume`: there is none. */
export declare class ResumeError extends Error {
    readonly code: "resume_required" | "nothing_to_resume";
    constructor(code: ResumeError["code"], message: string);
}
export interface ContextBudget {
    maxTokens: number;
    responseReserve: number;
    /** Count the complete request, including instructions and tool definitions. */
    countTokens: (request: Item) => number;
    keepTurns?: number;
}
export interface SessionOptions {
    /** Where the session is kept. Default: memory that belongs to this Session alone. */
    storage?: Storage;
    /** Shorthand for `storage: new FileStorage(directory)`. Node only: the Session exported by the browser entry refuses it. */
    directory?: string;
    sessionId?: string;
    /** Open the stored session `sessionId` instead of creating one. */
    resume?: boolean;
    budget?: ContextBudget;
    /**
     * What to do with a tool call that a crash interrupted and that is not safe
     * to repeat. "tell_model" (the default) tells the model it may have partly run.
     * "reconcile" refuses to run until `reconcile(note)` is called.
     */
    onUncertain?: "tell_model" | "reconcile";
}
export interface EventPage {
    events: AgentEvent[];
    /** Pass as `after` for the next page. Null when this page reached the end. */
    nextAfter: number | null;
}
export declare class Session {
    readonly agent: Agent;
    readonly id: string;
    readonly budget: ContextBudget | undefined;
    readonly recoveryNotes: string[];
    /**
     * Settles when the session has been read from, or created in, its storage.
     * The built-in stores are synchronous, so it is already settled when the
     * constructor returns. With a store that returns promises, await it before
     * reading `history`, `records`, `resumable` or `recoveryRequired`.
     */
    readonly ready: Promise<void>;
    private readonly storage;
    private readonly onUncertain;
    private opened;
    /** The digest of the agent configuration last written to the journal. */
    private recorded;
    private saved;
    private transcript;
    private open;
    private readonly messages;
    private lastUsage;
    private checkpoint;
    private closed;
    private failed;
    private running;
    /** The append in flight on an asynchronous store. The next one waits for it. */
    private writing;
    /** Marks code this session is running: its own handlers, hooks and event callbacks. */
    private readonly inside;
    private active;
    constructor(agent: Agent, options?: SessionOptions);
    /** The store behind the `directory` option. Files need Node: the Session the Node entry exports provides it. */
    protected static directoryStorage(_directory: string): Storage;
    get history(): Item[];
    get records(): Item[];
    /** The sequence of the last journal record: where `events({ after })` would have nothing left. */
    get cursor(): number;
    /** Token usage of the most recent run, when one has finished. */
    get usage(): Usage | undefined;
    /**
     * True while the session refuses to run until `reconcile(note)`: only when it
     * was created with `onUncertain: "reconcile"` and a crash interrupted a tool
     * call that is not safe to repeat.
     */
    get recoveryRequired(): boolean;
    /** The tool call a paused run is waiting on. Supply its result with `resume({ result })` or `resume({ error })`. */
    get paused(): PendingPause | undefined;
    /** True when a run was interrupted and `resume()` can continue it. */
    get resumable(): boolean;
    inspect(options?: {
        offset?: number;
        limit?: number;
        view?: string;
    }): Item;
    /**
     * What happened, rebuilt from the journal: the events of every run, each
     * with the `cursor` of the record it came from. Text arrives as one
     * `text_delta` per stored assistant message. A run that failed or was
     * cancelled ends with its real status, so a client that polls can tell.
     */
    events(options?: {
        after?: number;
        limit?: number;
    }): EventPage;
    private configuration;
    /** A pending call is repeated only when the journal and today's agent both call its tool idempotent. */
    private rerunnable;
    /** Read the stored records. Synchronous when the store is. */
    private restore;
    /** A session may be continued by a changed agent. The journal says when that happened. */
    private noteConfiguration;
    /**
     * Store one record, then fold it into this object's view. Synchronous when
     * the store is. With an asynchronous store the appends of a session are
     * strictly one after another.
     */
    private append;
    private apply;
    private enter;
    private leave;
    /**
     * Record what you found out about an interrupted tool call and let the
     * session run again. The note joins the conversation; the interrupted run
     * does not.
     */
    reconcile(note: string): Promise<void>;
    /**
     * End the interrupted or paused run without continuing it. The run is
     * recorded as failed with code `abandoned`, and the session takes a new prompt.
     */
    abandon(reason?: string): Promise<void>;
    /** A tool call still in flight is recorded as interrupted, so no start is left without an end. */
    private settle;
    /** Close the open run as failed or aborted. */
    private failRun;
    private context;
    /**
     * Run one prompt as ordered events. With a `messageId` that already
     * committed, nothing runs and the stored answer comes back with
     * `repeated: true`; with one whose run was interrupted, that run continues.
     */
    stream(prompt: Content, options?: Omit<RunOptions, "onEvent">): AsyncGenerator<AgentEvent, RunResult>;
    /** `prompt` undefined continues the open run. Every run of a session goes through here, into the one agent loop. */
    private execute;
    run(prompt: Content, options?: RunOptions): Promise<RunResult>;
    /**
     * Continue the run a crash interrupted. A tool call that had finished is
     * kept. One that was in flight is run again if its tool is idempotent;
     * otherwise the model is told it was interrupted. A paused run needs
     * `result` or `error`: what its waiting tool call returns.
     */
    resume(options?: RunOptions): Promise<RunResult>;
    private drive;
    private count;
    private prepare;
    compact(options?: RunOptions): Promise<boolean>;
    /** `usage` is added to: the summary request is paid for by the run that needed it. */
    private compactHistory;
    /**
     * Stop any run, wait for its cleanup, and release the storage. The stored
     * session is kept. Host code that ignores cancellation is abandoned after a
     * short wait. Calling this from inside the session's own handler, hook or
     * event callback throws SessionBusyError at once.
     */
    close(): Promise<void>;
}
