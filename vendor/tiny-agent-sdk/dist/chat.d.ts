import { type EventTransport, type Provider, type ProviderRequest, type ProviderEvent, type ProviderTurn } from "./types.ts";
import { type HttpRequestOptions } from "./sse.ts";
export interface ChatCompletionsProviderOptions extends HttpRequestOptions {
    /** Default: OPENAI_API_KEY, read when a request starts. Without either, no Authorization header is sent. */
    apiKey?: string;
    eventTransport?: EventTransport;
}
/**
 * The OpenAI-compatible `/chat/completions` streaming API, which most gateways
 * and self-hosted model servers offer. Set `baseUrl` to the server's API root.
 */
export declare class ChatCompletionsProvider implements Provider {
    private readonly options;
    private readonly eventTransport;
    constructor(options?: ChatCompletionsProviderOptions);
    stream(request: ProviderRequest): AsyncGenerator<ProviderEvent, ProviderTurn>;
    private httpEvents;
}
