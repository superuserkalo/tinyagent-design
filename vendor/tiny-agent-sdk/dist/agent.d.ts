import { Tool, type Item, type Content, type Transport, type Provider, type AgentEvent, type RunResult, type RunOptions, type RunLimits, type RunHooks, type BeforeTool, type AfterTool } from "./types.ts";
export interface AgentOptions extends RunLimits {
    model: string;
    instructions?: string;
    tools?: Tool[];
    apiKey?: string;
    provider?: Provider;
    transport?: Transport;
    /** Runs before every tool call, after its arguments are validated. */
    beforeTool?: BeforeTool;
    /** Runs after every successful tool call and may replace its result. */
    afterTool?: AfterTool;
    /** The random part of run and session IDs. Default: a UUID without dashes. */
    newId?: () => string;
    /** Also emit `model_request_start`, `model_request_end` and `reasoning_delta` events. Default false. */
    trace?: boolean;
    /** Waits between provider retries. It must reject or return when the signal aborts. */
    sleep?: (milliseconds: number, signal: AbortSignal) => Promise<unknown>;
}
export declare class Agent {
    readonly model: string;
    readonly instructions: string;
    readonly tools: Map<string, Tool>;
    readonly provider: Provider;
    readonly limits: RunLimits;
    readonly beforeTool: BeforeTool | undefined;
    readonly afterTool: AfterTool | undefined;
    readonly newId: () => string;
    readonly trace: boolean;
    private readonly sleep;
    constructor(options: AgentOptions);
    /**
     * The agent loop: ask the model, run the tools it calls, repeat until it
     * answers without calling one. `hooks` is how a Session journals the run and
     * continues an interrupted one; everything else leaves it out.
     */
    stream(prompt: Content, history?: Item[], options?: Omit<RunOptions, "onEvent" | "messageId">, hooks?: RunHooks): AsyncGenerator<AgentEvent, RunResult>;
    /** One model request: its deltas, then the complete turn. Leaving it early releases the provider. */
    private request;
    run(prompt: Content, history?: Item[], options?: RunOptions): Promise<RunResult>;
}
