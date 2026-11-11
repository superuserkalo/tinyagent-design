import { Ajv2020 } from "ajv/dist/2020.js";
export function isContentParts(value) {
    return Array.isArray(value) && value.length > 0 && value.every((part) => isItem(part) &&
        ((part.type === "text" && typeof part.text === "string") ||
            (part.type === "image" && (typeof part.url === "string" ||
                (typeof part.data === "string" && typeof part.mediaType === "string")))));
}
/** An image part as one URL: its own, or a data URL built from its base64 data. */
export function imageUrl(part) {
    return typeof part.url === "string" ? part.url : `data:${String(part.mediaType)};base64,${String(part.data)}`;
}
/** Returned by a handler or a beforeTool hook to stop the run until its Session is resumed with this call's result. */
export class Pause {
    payload;
    constructor(payload) {
        this.payload = payload;
    }
}
/**
 * End the run here and wait for someone else to supply this tool call's
 * result: `return pause({ question: "Deploy to production?" })`. The payload
 * must be JSON; it is journaled and shown to whoever resumes.
 */
export function pause(payload = null) {
    return new Pause(payload);
}
/** Throw this from a handler to give the model exactly this text as the tool error. */
export class ToolError extends Error {
    constructor(message) {
        super(message);
        this.name = "ToolError";
    }
}
/** A handler that honours its signal gets this long to report what it has before the timeout is final. */
const TIMEOUT_GRACE_MS = 1000;
/** A longer timeout would overflow the timer and fire at once. */
export const MAX_TIMEOUT_SECONDS = 86_400;
/** After a run is cancelled, host code that does not stop is abandoned after this long. */
export const CANCEL_GRACE_MS = 1000;
/**
 * Wait for host code (a handler, a hook, a provider, an event callback), but
 * not for ever: once `signal` has fired, the wait ends with an AbortError
 * after the grace period whether or not that code has settled.
 */
export function guarded(work, signal) {
    if (!isPromise(work))
        return Promise.resolve(work);
    return new Promise((resolve, reject) => {
        let timer;
        const give = () => { timer ??= setTimeout(() => reject(abortError()), CANCEL_GRACE_MS); };
        const settle = () => { clearTimeout(timer); signal.removeEventListener("abort", give); };
        signal.addEventListener("abort", give, { once: true });
        if (signal.aborted)
            give();
        work.then((value) => { settle(); resolve(value); }, (error) => { settle(); reject(error); });
    });
}
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** Strings as they are stored and sent: lone surrogates become U+FFFD. Everything else is copied as it is. */
export function wellFormed(value) {
    if (typeof value === "string")
        return value.replace(LONE_SURROGATE, "\uFFFD");
    if (Array.isArray(value))
        return value.map(wellFormed);
    if (isItem(value))
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [wellFormed(key), wellFormed(item)]));
    return value;
}
/** Throws a TypeError for content nested deeper than a prompt has any reason to be. */
export function checkDepth(value, limit = 32) {
    if (typeof value !== "object" || value === null)
        return;
    if (limit === 0)
        throw new TypeError("content is nested too deeply");
    for (const item of Array.isArray(value) ? value : Object.values(value))
        checkDepth(item, limit - 1);
}
/** Run options are checked before anything starts. A wrong one is a TypeError and leaves nothing behind. */
export function checkRunOptions(options) {
    if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
        throw new TypeError("signal must be an AbortSignal");
    for (const name of ["maxSteps", "maxSeconds", "maxTokens"]) {
        const limit = options[name];
        if (limit !== undefined && !(typeof limit === "number" && Number.isFinite(limit) && limit >= 0))
            throw new TypeError(`${name} must be a finite number that is not negative`);
    }
    if (options.outputSchema !== undefined && !isItem(options.outputSchema))
        throw new TypeError("outputSchema must be an object");
    if (options.extra !== undefined && !isItem(options.extra))
        throw new TypeError("extra must be an object");
    if ("error" in options && options.error !== undefined && typeof options.error !== "string")
        throw new TypeError("error must be a string");
}
/**
 * Run `work` with a signal that also fires after `seconds`. On expiry the call
 * fails with a ToolError: the one `work` throws if it stops promptly, or
 * "timed out after N s".
 */
export async function withTimeout(seconds, signal, work) {
    if (seconds === undefined)
        return await work(signal);
    const expiry = new AbortController();
    const expired = new ToolError(`timed out after ${seconds} s`);
    let grace;
    const timeout = new Promise((_resolve, reject) => {
        expiry.signal.addEventListener("abort", () => { grace = setTimeout(() => reject(expired), TIMEOUT_GRACE_MS); });
    });
    timeout.catch(() => { });
    const timer = setTimeout(() => expiry.abort(expired), Math.min(seconds, MAX_TIMEOUT_SECONDS) * 1000);
    try {
        const running = Promise.resolve().then(() => work(AbortSignal.any([signal, expiry.signal])));
        return await Promise.race([running, timeout]);
    }
    catch (error) {
        if (expiry.signal.aborted && !signal.aborted && !(error instanceof ToolError))
            throw expired;
        throw error;
    }
    finally {
        clearTimeout(timer);
        clearTimeout(grace);
    }
}
export class Tool {
    name;
    description;
    parameters;
    handler;
    idempotent;
    timeoutSeconds;
    beforeTool;
    validate;
    constructor(options) {
        this.name = options.name;
        this.description = options.description;
        this.parameters = structuredClone(options.parameters);
        this.handler = options.handler;
        this.idempotent = options.idempotent ?? false;
        this.timeoutSeconds = options.timeoutSeconds;
        this.beforeTool = options.beforeTool;
        if (this.timeoutSeconds !== undefined && !(this.timeoutSeconds > 0 && Number.isFinite(this.timeoutSeconds)))
            throw new TypeError("timeoutSeconds must be a positive finite number");
        if (this.parameters.$async)
            throw new TypeError("Tool schemas must use synchronous validation");
        // One validator per tool: nothing is shared between tools or kept at module level.
        // Validation is synchronous and local. $ref never triggers a network request.
        this.validate = new Ajv2020({ strict: false, validateFormats: false, addUsedSchema: false, ownProperties: true })
            .compile(this.parameters);
    }
    definition() {
        return {
            type: "function",
            name: this.name,
            description: this.description,
            strict: true,
            parameters: this.parameters,
        };
    }
    /** Throws a TypeError naming the first schema mismatch. */
    check(arguments_) {
        if (!this.validate(arguments_)) {
            const error = this.validate.errors?.[0];
            throw new TypeError(`Invalid arguments for ${this.name}${error?.instancePath ?? ""}: ${error?.message ?? "schema mismatch"}`);
        }
    }
    /** Validate, then call the handler. Without a timeout the handler's own return value is passed through. */
    execute(arguments_, signal, context = {}) {
        this.check(arguments_);
        const call = (scoped) => this.handler(arguments_, scoped, {
            executionId: context.executionId ?? "", context: context.context, signal: scoped,
            get timedOut() { return scoped.aborted && !signal.aborted && scoped.reason instanceof ToolError; },
        });
        return this.timeoutSeconds === undefined ? call(signal) : withTimeout(this.timeoutSeconds, signal, call);
    }
}
export class ProviderError extends Error {
    /** True only when the request failed before any of the response body arrived and may be sent again. */
    retryable;
    /** Seconds the server asked the client to wait, from Retry-After. */
    retryAfter;
    constructor(message, options = {}) {
        super(message);
        this.name = "ProviderError";
        this.retryable = options.retryable ?? false;
        this.retryAfter = options.retryAfter;
    }
}
/** The journal could not be written. The session that hit it stops; open it again. */
export class StorageError extends Error {
    code = "storage_error";
    constructor(cause) {
        super(errorMessage(cause), { cause });
        this.name = "StorageError";
    }
}
/** A run the agent ended itself. `code` is `limit_exceeded`, `repeated_tool_errors`, `hook_error` or `output_missing`. */
export class RunError extends Error {
    code;
    limit;
    constructor(code, message, limit) {
        super(message);
        this.name = "RunError";
        this.code = code;
        this.limit = limit;
    }
}
export class ToolOutputLimitError extends Error {
    constructor(message) {
        super(message);
        this.name = "ToolOutputLimitError";
    }
}
export function isItem(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isPromise(value) {
    return typeof value?.then === "function";
}
/** The text of a stored assistant message, whichever of the two shapes it has. */
export function assistantText(item) {
    if (typeof item.content === "string")
        return item.content;
    if (!Array.isArray(item.content))
        return "";
    return item.content.map((block) => isItem(block) && block.type === "text" && typeof block.text === "string"
        ? block.text : "").join("");
}
export function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
export function abortError() {
    const error = new Error("run aborted");
    error.name = "AbortError";
    return error;
}
export function isAbortError(error) {
    return error instanceof Error && error.name === "AbortError";
}
export function throwIfAborted(signal) {
    if (signal.aborted)
        throw abortError();
}
// What follows stands in for Node APIs, so that everything a browser can run imports nothing from Node.
/** The length of `text` in UTF-8 bytes, a lone surrogate counting as U+FFFD: what Buffer.byteLength returns. */
export function utf8Length(text) {
    let bytes = 0;
    for (let index = 0; index < text.length; index++) {
        const unit = text.charCodeAt(index);
        if (unit < 0x80)
            bytes += 1;
        else if (unit < 0x800)
            bytes += 2;
        else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length &&
            text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
            bytes += 4;
            index += 1;
        }
        else
            bytes += 3;
    }
    return bytes;
}
/** The first `length` bytes of `parts` joined into one array. */
export function concatBytes(parts, length) {
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        if (offset >= length)
            break;
        const piece = part.subarray(0, length - offset);
        joined.set(piece, offset);
        offset += piece.length;
    }
    return joined;
}
/** An environment variable, where the runtime has them. A browser has none. */
export function environment(name) {
    return globalThis.process?.env?.[name];
}
/** 32 random hex digits: a version 4 UUID without its dashes. */
export function randomId() {
    // getRandomValues, unlike randomUUID, also works in a page that is not served over HTTPS.
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** Wait `milliseconds`, or reject with an AbortError as soon as `signal` fires. */
export function sleep(milliseconds, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted)
            return reject(abortError());
        const abort = () => {
            clearTimeout(timer);
            reject(abortError());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
        }, milliseconds);
        signal?.addEventListener("abort", abort, { once: true });
    });
}
