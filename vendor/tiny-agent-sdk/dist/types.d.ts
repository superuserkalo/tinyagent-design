export type Item = Record<string, unknown>;
export type Transport = (payload: Item) => Promise<Item[]> | Item[];
export type EventTransport = (payload: Item, signal: AbortSignal) => AsyncIterable<Item>;
export type OpenAIEventTransport = EventTransport;
/** One piece of a prompt or of a tool's result. An image is base64 `data` with its `mediaType`, or a `url`. */
export type ContentPart = {
    type: "text";
    text: string;
} | {
    type: "image";
    mediaType: string;
    data: string;
} | {
    type: "image";
    url: string;
};
/** Text, or text and images in order. */
export type Content = string | ContentPart[];
export declare function isContentParts(value: unknown): value is ContentPart[];
/** An image part as one URL: its own, or a data URL built from its base64 data. */
export declare function imageUrl(part: Item): string;
/** What a tool handler is told about the call it serves. */
export interface ToolContext {
    /** Aborts when the run is cancelled or the tool's timeout expires. */
    signal: AbortSignal;
    /** Stable across a rerun of the same call: "<sessionId>:<intent sequence>", or the call ID outside a Session. */
    executionId: string;
    /** The host value passed as the run's `context` option. Never journaled or sent to the model. */
    context: unknown;
    /** True once the tool's `timeoutSeconds` has expired: the signal fired for that, not for a cancelled run. */
    readonly timedOut: boolean;
}
/** The recommended form is `(args, signal, { executionId }) => ...`; the last two parameters are optional. */
export type ToolHandler = (arguments_: Item, signal: AbortSignal, context: ToolContext) => unknown | Promise<unknown>;
export interface ToolCall {
    callId: string;
    name: string;
    arguments: Item;
}
/** Returned by a handler or a beforeTool hook to stop the run until its Session is resumed with this call's result. */
export declare class Pause {
    readonly payload: unknown;
    constructor(payload: unknown);
}
/**
 * End the run here and wait for someone else to supply this tool call's
 * result: `return pause({ question: "Deploy to production?" })`. The payload
 * must be JSON; it is journaled and shown to whoever resumes.
 */
export declare function pause(payload?: unknown): Pause;
/** The tool call a paused run is waiting on. */
export interface PendingPause {
    toolCallId: string;
    toolName: string;
    payload: unknown;
}
/** A hook's verdict on a tool call: run it, refuse it with a reason, run it with other arguments, or pause. */
export type ToolDecision = undefined | {
    deny: string;
} | {
    arguments: Item;
} | Pause;
export type BeforeTool = (call: ToolCall, context: ToolContext) => ToolDecision | Promise<ToolDecision>;
/** A settled tool call as the model will see it. */
export interface ToolResult {
    output: Content;
    isError: boolean;
}
/**
 * Sees every tool call that ran, whether it succeeded or failed. Return
 * undefined to keep the result, a string to replace its output, or
 * `{ output, isError }` to replace both.
 */
export type AfterTool = (call: ToolCall, result: ToolResult, context: ToolContext) => undefined | string | {
    output: Content;
    isError?: boolean;
} | Promise<undefined | string | {
    output: Content;
    isError?: boolean;
}>;
export interface ToolOptions {
    name: string;
    description: string;
    parameters: Item;
    handler: ToolHandler;
    /** True when running the same call twice is harmless. An interrupted idempotent call is rerun on resume. */
    idempotent?: boolean;
    /** Fire the handler's signal and report a tool error after this many seconds. */
    timeoutSeconds?: number;
    /** A beforeTool hook for this tool alone. It runs before the Agent's. */
    beforeTool?: BeforeTool;
}
/** Throw this from a handler to give the model exactly this text as the tool error. */
export declare class ToolError extends Error {
    constructor(message: string);
}
/** A longer timeout would overflow the timer and fire at once. */
export declare const MAX_TIMEOUT_SECONDS = 86400;
/** After a run is cancelled, host code that does not stop is abandoned after this long. */
export declare const CANCEL_GRACE_MS = 1000;
/**
 * Wait for host code (a handler, a hook, a provider, an event callback), but
 * not for ever: once `signal` has fired, the wait ends with an AbortError
 * after the grace period whether or not that code has settled.
 */
export declare function guarded<T>(work: T | Promise<T>, signal: AbortSignal): Promise<T>;
/** Strings as they are stored and sent: lone surrogates become U+FFFD. Everything else is copied as it is. */
export declare function wellFormed<T>(value: T): T;
/** Throws a TypeError for content nested deeper than a prompt has any reason to be. */
export declare function checkDepth(value: unknown, limit?: number): void;
/** Run options are checked before anything starts. A wrong one is a TypeError and leaves nothing behind. */
export declare function checkRunOptions(options: RunOptions): void;
/**
 * Run `work` with a signal that also fires after `seconds`. On expiry the call
 * fails with a ToolError: the one `work` throws if it stops promptly, or
 * "timed out after N s".
 */
export declare function withTimeout<T>(seconds: number | undefined, signal: AbortSignal, work: (signal: AbortSignal) => T | Promise<T>): Promise<T>;
export declare class Tool {
    readonly name: string;
    readonly description: string;
    readonly parameters: Item;
    readonly handler: ToolHandler;
    readonly idempotent: boolean;
    readonly timeoutSeconds: number | undefined;
    readonly beforeTool: BeforeTool | undefined;
    private readonly validate;
    constructor(options: ToolOptions);
    definition(): Item;
    /** Throws a TypeError naming the first schema mismatch. */
    check(arguments_: Item): void;
    /** Validate, then call the handler. Without a timeout the handler's own return value is passed through. */
    execute(arguments_: Item, signal: AbortSignal, context?: Partial<ToolContext>): unknown | Promise<unknown>;
}
export interface ProviderEvent {
    /** `reasoning_delta` is the model's visible reasoning, where the API streams it. */
    type: "text_delta" | "reasoning_delta";
    delta: string;
}
export interface ProviderTurn {
    text: string;
    assistant: Item;
    output: Item[];
    toolCalls: ToolCall[];
    /** Token counts for this request, when the API reported them. */
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}
export interface ProviderRequest {
    model: string;
    instructions: string;
    history: Item[];
    tools: Tool[];
    signal: AbortSignal;
    /** Merged into the request body after everything else. */
    extra?: Item;
}
export interface Provider {
    stream(request: ProviderRequest): AsyncGenerator<ProviderEvent, ProviderTurn>;
}
/** Tokens and model requests, summed over one run. */
export interface Usage {
    inputTokens: number;
    outputTokens: number;
    requests: number;
}
/** Each is checked before a model request. Undefined means unlimited. */
export interface RunLimits {
    /** Model requests per run. */
    maxSteps?: number;
    /** Wall-clock seconds per run. */
    maxSeconds?: number;
    /** Input plus output tokens per run. */
    maxTokens?: number;
}
interface EventBase {
    runId: string;
    sequence: number;
    /**
     * The sequence of the journal record this event stands for. Events from
     * `session.events()` always have one. Live session events have one when a
     * record exists for them; text and reasoning deltas never do.
     */
    cursor?: number;
}
export type CompactionEventData = {
    type: "compaction_start";
} | {
    type: "compaction_end";
    status: "completed";
    changed: boolean;
} | {
    type: "compaction_end";
    status: "failed" | "aborted";
    error: string;
};
export interface RunFailure {
    code: string;
    message: string;
    retryable: boolean;
    limit?: "steps" | "seconds" | "tokens";
}
export type AgentEvent = (EventBase & {
    type: "agent_start";
    resumed?: true;
    repeated?: true;
}) | (EventBase & {
    type: "model_request_start";
    attempt: number;
}) | (EventBase & {
    type: "model_request_end";
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
}) | (EventBase & {
    type: "model_request_end";
    error: {
        code: string;
        message: string;
    };
    willRetry: boolean;
}) | (EventBase & {
    type: "reasoning_delta";
    delta: string;
}) | (EventBase & CompactionEventData) | (EventBase & {
    type: "text_delta";
    delta: string;
}) | (EventBase & {
    type: "tool_execution_start";
    toolCallId: string;
    toolName: string;
    arguments: Item;
    executionId: string;
    rerun?: true;
    interrupted?: true;
    resumed?: true;
}) | (EventBase & {
    type: "tool_execution_end";
    toolCallId: string;
    toolName: string;
    output: Content;
    isError: boolean;
    paused?: true;
}) | (EventBase & {
    type: "agent_end";
    status: "completed";
    text: string;
    usage: Usage;
    repeated?: true;
    value?: unknown;
}) | (EventBase & {
    type: "agent_end";
    status: "paused";
    pause: PendingPause;
    usage: Usage;
}) | (EventBase & {
    type: "agent_end";
    status: "failed";
    error: RunFailure;
    usage: Usage;
}) | (EventBase & {
    type: "agent_end";
    status: "aborted";
    usage: Usage;
});
export interface RunResult {
    text: string;
    history: Item[];
    /** The provider's raw output items for the final turn. Empty for a resumed or repeated run. */
    output: Item[];
    /** With `outputSchema`: the validated object the model finished with. */
    value?: unknown;
    usage: Usage;
    /** Set when the run stopped at `pause()`. Nothing was committed; resume the Session to continue. */
    pause?: PendingPause;
    /** True when a prompt's messageId had already committed and nothing ran. */
    repeated?: boolean;
}
export interface RunOptions extends RunLimits {
    signal?: AbortSignal;
    runId?: string;
    onEvent?: (event: AgentEvent) => void | Promise<void>;
    /** Session runs only: a caller-chosen ID that makes a repeated prompt safe. */
    messageId?: string;
    /** A host value handed to tool handlers and hooks. Never journaled or sent to the model. */
    context?: unknown;
    /** Use this model for the run instead of the agent's. */
    model?: string;
    /** Use these instructions for the run instead of the agent's. */
    instructions?: string;
    /** Merged into each request body, over the provider's own `extra`. */
    extra?: Item;
    /**
     * A JSON Schema for an object. The model must finish by calling a tool
     * with arguments that match it; they become `result.value`.
     */
    outputSchema?: Item;
    /** Also emit `model_request_start`, `model_request_end` and `reasoning_delta` events. Overrides the agent's setting. */
    trace?: boolean;
    /** `session.resume` only: the result of the tool call a paused run is waiting on. */
    result?: unknown;
    /** `session.resume` only: fail the paused tool call with this message instead. */
    error?: string;
}
/** The unfinished part of an interrupted run, as its Session read it from the journal. */
export interface ResumeState {
    /** The run's journaled history items, starting with its prompt. */
    items: Item[];
    /** Tool calls of the last model turn that have no result yet. */
    calls: ToolCall[];
    /** Set when the first of `calls` was started and never finished. `answer` is its result, supplied to a paused run. */
    pending?: {
        sequence: number;
        rerun: boolean;
        answer?: {
            result: unknown;
        } | {
            error: string;
        };
    };
    /** True when nothing is left but to commit: the final reply, or the typed output, is already journaled. */
    final: boolean;
    /** The typed output a `final_output` call had delivered before the interruption. */
    value?: {
        value: unknown;
    };
}
/** How a Session makes a run durable. `Agent.stream` works without it. The Session journals the prompt itself. */
export interface RunHooks {
    sessionId?: string;
    /** Append one journal record durably and return its sequence. */
    record?: (record: Item) => number | Promise<number>;
    /** Compact before a request if needed. `usage` is what the summary request cost. */
    prepare?: (history: Item[]) => AsyncGenerator<CompactionEventData, {
        history: Item[];
        usage?: Usage;
    }>;
    resume?: ResumeState;
    /** Calls host code: a tool handler or a beforeTool or afterTool hook. The Session uses it to know when that code calls it back. */
    host?: <T>(call: () => T) => T;
}
export declare class ProviderError extends Error {
    /** True only when the request failed before any of the response body arrived and may be sent again. */
    readonly retryable: boolean;
    /** Seconds the server asked the client to wait, from Retry-After. */
    readonly retryAfter: number | undefined;
    constructor(message: string, options?: {
        retryable?: boolean;
        retryAfter?: number;
    });
}
/** The journal could not be written. The session that hit it stops; open it again. */
export declare class StorageError extends Error {
    readonly code = "storage_error";
    constructor(cause: unknown);
}
/** A run the agent ended itself. `code` is `limit_exceeded`, `repeated_tool_errors`, `hook_error` or `output_missing`. */
export declare class RunError extends Error {
    readonly code: string;
    readonly limit: RunFailure["limit"];
    constructor(code: string, message: string, limit?: RunFailure["limit"]);
}
export declare class ToolOutputLimitError extends Error {
    constructor(message: string);
}
export declare function isItem(value: unknown): value is Item;
export declare function isPromise<T>(value: T | Promise<T>): value is Promise<T>;
/** The text of a stored assistant message, whichever of the two shapes it has. */
export declare function assistantText(item: Item): string;
export declare function errorMessage(error: unknown): string;
export declare function abortError(): Error;
export declare function isAbortError(error: unknown): boolean;
export declare function throwIfAborted(signal: AbortSignal): void;
/** The length of `text` in UTF-8 bytes, a lone surrogate counting as U+FFFD: what Buffer.byteLength returns. */
export declare function utf8Length(text: string): number;
/** The first `length` bytes of `parts` joined into one array. */
export declare function concatBytes(parts: Uint8Array[], length: number): Uint8Array;
/** An environment variable, where the runtime has them. A browser has none. */
export declare function environment(name: string): string | undefined;
/** 32 random hex digits: a version 4 UUID without its dashes. */
export declare function randomId(): string;
/** Wait `milliseconds`, or reject with an AbortError as soon as `signal` fires. */
export declare function sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
export {};
