import { type EventTransport, type Provider, type ProviderRequest, type ProviderEvent, type ProviderTurn } from "./types.ts";
import { type HttpRequestOptions } from "./sse.ts";
export interface AnthropicProviderOptions extends HttpRequestOptions {
    apiKey?: string;
    eventTransport?: EventTransport;
    maxTokens?: number;
}
export declare class AnthropicProvider implements Provider {
    private readonly options;
    private readonly eventTransport;
    private readonly maxTokens;
    constructor(options?: AnthropicProviderOptions);
    stream(request: ProviderRequest): AsyncGenerator<ProviderEvent, ProviderTurn>;
    private httpEvents;
}
