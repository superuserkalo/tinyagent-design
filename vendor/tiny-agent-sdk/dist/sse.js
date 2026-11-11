import { ProviderError, isItem, errorMessage, abortError, throwIfAborted, utf8Length, concatBytes } from "./types.js";
export const MAX_SSE_BYTES = 1_048_576;
/** Complete arguments stay bounded across individually small deltas. */
export class Arguments {
    parts = [];
    bytes = 0;
    append(value) {
        const added = utf8Length(value);
        if (added > MAX_SSE_BYTES - this.bytes)
            throw new ProviderError("tool arguments exceed their byte limit");
        this.parts.push(value);
        this.bytes += added;
    }
    set(value) {
        this.parts = [];
        this.bytes = 0;
        this.append(value);
    }
    value() {
        return this.parts.join("");
    }
}
export function objectValue(value, name) {
    if (!isItem(value))
        throw new ProviderError("invalid provider object: " + name);
    return value;
}
export function stringValue(value, key, required = false) {
    const field = value[key];
    if (typeof field !== "string" || (required && !field))
        throw new ProviderError("invalid provider string: " + key);
    return field;
}
export function indexValue(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        throw new ProviderError("invalid provider block index");
    return value;
}
export function objectArray(value, name) {
    if (!Array.isArray(value))
        throw new ProviderError("invalid provider array: " + name);
    const values = value;
    return values.map((item) => objectValue(item, name));
}
export function parseObject(source) {
    try {
        const value = JSON.parse(source);
        return objectValue(value, "JSON");
    }
    catch (error) {
        if (error instanceof ProviderError)
            throw error;
        throw new ProviderError("invalid provider JSON: " + errorMessage(error));
    }
}
export async function* httpSseEvents(endpoint, payload, headers, signal, options = {}, 
/** Yielded for a closing `data: [DONE]`. Without it that marker means the stream was cut short. */
done) {
    throwIfAborted(signal);
    const timeoutMs = options.timeoutMs ?? 180_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
        throw new ProviderError("provider timeoutMs must be a positive timer-sized integer");
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
        throw new ProviderError("provider endpoint must be an HTTP or HTTPS URL");
    // A value with a control character is a mistake (a key read with its newline). It is refused
    // here, by name only, so the value itself can never end up in an error, an event or the journal.
    const sent = mergeHeaders(headers, options.headers);
    for (const [name, value] of Object.entries(sent))
        if (/[\u0000-\u001f\u007f]/.test(value))
            throw new ProviderError(`request header ${name} contains a control character`);
    const controller = new AbortController();
    const requestSignal = AbortSignal.any([signal, controller.signal]);
    let expired = false;
    const timer = setTimeout(() => {
        expired = true;
        controller.abort();
    }, timeoutMs);
    let reader;
    let cancelling;
    const cancelBody = () => {
        if (!reader)
            return Promise.resolve();
        cancelling ??= reader.cancel().catch(() => { });
        return cancelling;
    };
    const abort = () => {
        void cancelBody();
    };
    try {
        let response;
        try {
            response = await (options.fetch ?? globalThis.fetch)(url, {
                method: "POST",
                headers: sent,
                body: JSON.stringify(payload),
                signal: requestSignal,
            });
        }
        catch (error) {
            if (signal.aborted || expired)
                throw error;
            // Nothing of a response arrived, so sending the request again is safe.
            throw new ProviderError("provider connection failed: " + errorMessage(error), { retryable: true });
        }
        if (!response.body)
            throw new ProviderError("API response " + response.status + " has no body");
        reader = response.body.getReader();
        requestSignal.addEventListener("abort", abort, { once: true });
        throwIfAborted(requestSignal);
        if (!response.ok) {
            const parts = [];
            let bytes = 0;
            while (bytes < 8192) {
                const chunk = await reader.read();
                throwIfAborted(requestSignal);
                if (chunk.done)
                    break;
                const part = chunk.value.subarray(0, 8192 - bytes);
                parts.push(part);
                bytes += part.length;
            }
            // An error body may echo anything, the request included. It is reported in part only.
            const detail = new TextDecoder().decode(concatBytes(parts, bytes)).slice(0, 500);
            throw new ProviderError("API error " + response.status + ": " + detail, {
                retryable: [429, 500, 502, 503, 504].includes(response.status),
                retryAfter: retryAfterSeconds(response.headers.get("retry-after")),
            });
        }
        yield* sseEvents(reader, requestSignal, done);
        throwIfAborted(requestSignal);
    }
    catch (error) {
        if (signal.aborted)
            throw abortError();
        if (expired)
            throw new ProviderError("provider request timed out");
        throw error;
    }
    finally {
        clearTimeout(timer);
        requestSignal.removeEventListener("abort", abort);
        controller.abort();
        await cancelBody();
        reader?.releaseLock();
    }
}
/** Header names are case-insensitive, so a caller's "authorization" replaces the provider's "Authorization". */
function mergeHeaders(base, extra = {}) {
    const merged = new Map(Object.entries(base).map(([name, value]) => [name.toLowerCase(), value]));
    for (const [name, value] of Object.entries(extra))
        merged.set(name.toLowerCase(), value);
    return Object.fromEntries(merged);
}
/** Retry-After is honoured as a number of seconds. Its HTTP-date form is ignored. */
function retryAfterSeconds(header) {
    return header && /^\d+$/.test(header.trim()) ? Number(header) : undefined;
}
async function* sseEvents(reader, signal, done) {
    let data = [];
    let bytes = 0;
    for await (const line of sseLines(reader, signal)) {
        throwIfAborted(signal);
        if (line === "") {
            if (data.length)
                yield decodeEvent(data, done);
            throwIfAborted(signal);
            data = [];
            bytes = 0;
        }
        else if (line === "data" || line.startsWith("data:")) {
            let value = line === "data" ? "" : line.slice(5);
            if (value.startsWith(" "))
                value = value.slice(1);
            bytes += utf8Length(value) + (data.length ? 1 : 0);
            if (bytes > MAX_SSE_BYTES)
                throw new ProviderError("SSE event exceeds its byte limit");
            data.push(value);
        }
    }
    throwIfAborted(signal);
    if (data.length)
        yield decodeEvent(data, done);
}
function decodeEvent(lines, done) {
    const data = lines.join("\n");
    if (data === "[DONE]" && done)
        return done;
    if (data === "[DONE]")
        throw new ProviderError("provider stream ended without a complete turn");
    return parseObject(data);
}
async function* sseLines(reader, signal) {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let parts = [];
    let bytes = 0;
    while (true) {
        throwIfAborted(signal);
        const chunk = await reader.read();
        throwIfAborted(signal);
        if (chunk.done) {
            if (bytes)
                yield decoder.decode(concatBytes(parts, bytes)).replace(/\r$/, "");
            return;
        }
        let start = 0;
        while (start < chunk.value.length) {
            const newline = chunk.value.indexOf(0x0a, start);
            const end = newline < 0 ? chunk.value.length : newline;
            const part = chunk.value.subarray(start, end);
            bytes += part.length;
            if (bytes > MAX_SSE_BYTES)
                throw new ProviderError("SSE line exceeds its byte limit");
            if (part.length)
                parts.push(part);
            if (newline < 0)
                break;
            yield decoder.decode(concatBytes(parts, bytes)).replace(/\r$/, "");
            parts = [];
            bytes = 0;
            start = newline + 1;
        }
    }
}
