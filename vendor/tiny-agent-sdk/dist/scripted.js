import { ProviderError, throwIfAborted } from "./types.js";
/**
 * A provider for tests: it plays a fixed list of turns, one per model request,
 * and keeps the requests it was sent. No network, no keys.
 */
export class ScriptedProvider {
    /** Every request received, in order, with its history as it was at that moment. */
    requests = [];
    turns;
    constructor(turns) {
        this.turns = [...turns];
    }
    /** Turns not yet played. A finished script has none. */
    get remaining() {
        return this.turns.length;
    }
    async *stream(request) {
        throwIfAborted(request.signal);
        this.requests.push({ ...request, history: structuredClone(request.history) });
        let next = this.turns.shift();
        if (next === undefined)
            throw new ProviderError(`ScriptedProvider has no turn for request ${this.requests.length}`);
        while (typeof next === "function")
            next = await next(request);
        const turn = typeof next === "string" ? { text: next } : Array.isArray(next) ? { toolCalls: next } : next;
        if (turn.error)
            throw turn.error;
        const text = turn.text ?? "";
        for (const delta of turn.deltas ?? (text ? [text] : [])) {
            throwIfAborted(request.signal);
            yield { type: "text_delta", delta };
        }
        throwIfAborted(request.signal);
        const toolCalls = structuredClone(turn.toolCalls ?? []);
        const content = [...(text ? [{ type: "text", text }] : []),
            ...toolCalls.map((call) => ({ type: "tool_call", ...call }))];
        return { text, assistant: { role: "assistant", content }, output: [], toolCalls,
            ...(turn.usage ? { usage: turn.usage } : {}) };
    }
}
