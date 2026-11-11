import { type EventTransport, type Provider, type ProviderRequest, type ProviderEvent, type ProviderTurn, type Transport } from "./types.ts";
import { type HttpRequestOptions } from "./sse.ts";
export interface OpenAIProviderOptions extends HttpRequestOptions {
    apiKey?: string;
    eventTransport?: EventTransport;
}
export declare class OpenAIProvider implements Provider {
    private readonly options;
    private readonly eventTransport;
    constructor(options?: OpenAIProviderOptions);
    stream(request: ProviderRequest): AsyncGenerator<ProviderEvent, ProviderTurn>;
    private httpEvents;
}
export declare class CompleteTransportProvider implements Provider {
    private readonly transport;
    constructor(transport: Transport);
    stream(request: ProviderRequest): AsyncGenerator<ProviderEvent, ProviderTurn>;
}
