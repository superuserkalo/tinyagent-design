import { type Provider, type ProviderEvent, type ProviderRequest, type ProviderTurn, type ToolCall } from "./types.ts";
/**
 * One model turn of a script: text for a final answer, tool calls, or an
 * object for the details. `deltas` are streamed before the turn completes
 * (default: the text in one piece). `error` is thrown instead of answering.
 * A function is called with the request and returns any of these.
 */
export type ScriptedTurn = string | ToolCall[] | {
    text?: string;
    toolCalls?: ToolCall[];
    deltas?: string[];
    usage?: ProviderTurn["usage"];
    error?: Error;
} | ((request: ProviderRequest) => ScriptedTurn | Promise<ScriptedTurn>);
/**
 * A provider for tests: it plays a fixed list of turns, one per model request,
 * and keeps the requests it was sent. No network, no keys.
 */
export declare class ScriptedProvider implements Provider {
    /** Every request received, in order, with its history as it was at that moment. */
    readonly requests: ProviderRequest[];
    private readonly turns;
    constructor(turns: ScriptedTurn[]);
    /** Turns not yet played. A finished script has none. */
    get remaining(): number;
    stream(request: ProviderRequest): AsyncGenerator<ProviderEvent, ProviderTurn>;
}
